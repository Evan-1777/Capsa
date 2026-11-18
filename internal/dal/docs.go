package dal

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"capsa/internal/db"
	"capsa/internal/ids"
)

// DocPathMax caps a logical document path in characters.
const DocPathMax = 255

// documentFields is the shared projection for a single stored document.
const documentFields = "id, workspace_id, scope, category_id, path, length(content) AS char_count, content, created_at, updated_at"

// DuplicateDocNameError marks a category name clash so the transport layer can
// answer 422 without parsing driver messages.
type DuplicateDocNameError struct {
	Name string
}

func (e DuplicateDocNameError) Error() string { return "同名已存在：" + e.Name }

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

// NormalizeDocPath validates and returns a logical document path. The second
// return is a user-facing message; an empty message means the path is valid.
// It refuses empty paths, byte-level control characters, backslashes, leading
// or trailing slashes, empty segments and "." / ".." segments, so a path can
// never escape the scope it was created in.
func NormalizeDocPath(raw string) (string, string) {
	path := strings.TrimSpace(raw)
	if path == "" {
		return "", "文档路径不能为空"
	}
	if utf8.RuneCountInString(path) > DocPathMax {
		return "", fmt.Sprintf("文档路径超长（上限 %d 字符）", DocPathMax)
	}
	for _, r := range path {
		if r == '\\' {
			return "", "文档路径不能包含反斜杠"
		}
		if r < 0x20 || r == 0x7f {
			return "", "文档路径不能包含控制字符"
		}
	}
	if strings.HasPrefix(path, "/") || strings.HasSuffix(path, "/") {
		return "", "文档路径不能以斜杠开头或结尾"
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "" {
			return "", "文档路径不能包含连续斜杠"
		}
		if segment == "." || segment == ".." {
			return "", "文档路径不能包含 . 或 .. 片段"
		}
	}
	return path, ""
}

// ListDocCategories lists the categories of a docs workspace with their
// document counts.
func ListDocCategories(handle *sql.DB, workspaceID string) ([]map[string]any, error) {
	rows, err := queryMaps(handle, `
        SELECT c.id, c.workspace_id, c.name, c.description, c.access_id, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM documents d WHERE d.category_id = c.id) AS doc_count
        FROM doc_categories c
        WHERE c.workspace_id = ?
        ORDER BY c.created_at ASC, c.id ASC
        `, workspaceID)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// GetDocCategory fetches one category of a docs workspace, or nil when absent.
func GetDocCategory(handle *sql.DB, workspaceID, categoryID string) (map[string]any, error) {
	rows, err := queryMaps(handle, `
        SELECT c.id, c.workspace_id, c.name, c.description, c.access_id, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM documents d WHERE d.category_id = c.id) AS doc_count
        FROM doc_categories c
        WHERE c.workspace_id = ? AND c.id = ?
        `, workspaceID, categoryID)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// CreateDocCategory inserts a category with generated ids. A duplicate name in
// the same workspace returns DuplicateDocNameError.
func CreateDocCategory(handle *sql.DB, workspaceID, name, description string) (map[string]any, error) {
	stamp := db.UtcNow()
	categoryID := ids.NewDocCategoryID()
	_, err := handle.Exec(
		"INSERT INTO doc_categories (id, workspace_id, name, description, access_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		categoryID, workspaceID, name, description, ids.NewDocAccessID(), stamp, stamp)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, DuplicateDocNameError{Name: name}
		}
		return nil, err
	}
	return GetDocCategory(handle, workspaceID, categoryID)
}

// UpdateDocCategory renames a category. It returns "not_found",
// "duplicate_name" or "updated".
func UpdateDocCategory(handle *sql.DB, workspaceID, categoryID, name, description string) (string, error) {
	result, err := handle.Exec(
		"UPDATE doc_categories SET name = ?, description = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
		name, description, db.UtcNow(), workspaceID, categoryID)
	if err != nil {
		if isUniqueViolation(err) {
			return "duplicate_name", nil
		}
		return "", err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return "", err
	}
	if affected == 0 {
		return "not_found", nil
	}
	return "updated", nil
}

// RotateDocCategoryAccessID replaces a category access id. The previous value
// stops authenticating the moment this commits. A missing category returns nil.
func RotateDocCategoryAccessID(handle *sql.DB, workspaceID, categoryID string) (map[string]any, error) {
	result, err := handle.Exec(
		"UPDATE doc_categories SET access_id = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
		ids.NewDocAccessID(), db.UtcNow(), workspaceID, categoryID)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected == 0 {
		return nil, nil
	}
	return GetDocCategory(handle, workspaceID, categoryID)
}

// DeleteEmptyDocCategory deletes a category holding no documents. It returns
// "not_found", "has_documents" or "deleted".
func DeleteEmptyDocCategory(handle *sql.DB, workspaceID, categoryID string) (string, error) {
	ctx := context.Background()
	conn, err := handle.Conn(ctx)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return "", err
	}
	rollback := func() { _, _ = conn.ExecContext(ctx, "ROLLBACK") }
	var exists int
	if err := conn.QueryRowContext(ctx,
		"SELECT 1 FROM doc_categories WHERE workspace_id = ? AND id = ?", workspaceID, categoryID).Scan(&exists); err != nil {
		if err == sql.ErrNoRows {
			rollback()
			return "not_found", nil
		}
		rollback()
		return "", err
	}
	var count int
	if err := conn.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM documents WHERE workspace_id = ? AND category_id = ?", workspaceID, categoryID).Scan(&count); err != nil {
		rollback()
		return "", err
	}
	if count > 0 {
		rollback()
		return "has_documents", nil
	}
	if _, err := conn.ExecContext(ctx,
		"DELETE FROM doc_categories WHERE workspace_id = ? AND id = ?", workspaceID, categoryID); err != nil {
		rollback()
		return "", err
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return "", err
	}
	return "deleted", nil
}

// FindDocCategoryByAccessID resolves a category access id to its category and
// workspace. Only docs workspaces can authenticate this way; a token from a
// memory workspace or the traditional key table simply finds no row.
func FindDocCategoryByAccessID(handle *sql.DB, accessID string) (map[string]any, error) {
	rows, err := queryMaps(handle, `
        SELECT c.id AS category_id, c.name AS category_name, c.workspace_id, w.name AS workspace_name
        FROM doc_categories c
        JOIN workspaces w ON w.id = c.workspace_id
        WHERE c.access_id = ? AND w.mode = 'docs'
        `, accessID)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// DocQuery selects documents inside one workspace. ScopeFilter is "public",
// "category" or "all"; the category scope needs CategoryID, and "all" uses it
// only for the category half of the union.
type DocQuery struct {
	WorkspaceID    string
	ScopeFilter    string
	CategoryID     string
	PathSubstring  string
	ExactPath      string
	IncludeContent bool
}

// QueryDocuments is the single parameterised query builder for both list and
// search callers. Content is projected only when IncludeContent is set, so a
// listing never loads the largest column.
func QueryDocuments(handle *sql.DB, q DocQuery) ([]map[string]any, error) {
	fields := "id, workspace_id, scope, category_id, path, length(content) AS char_count, created_at, updated_at"
	if q.IncludeContent {
		fields += ", content"
	}
	conditions := []string{"workspace_id = ?"}
	params := []any{q.WorkspaceID}
	switch q.ScopeFilter {
	case "public":
		conditions = append(conditions, "scope = 'public'")
	case "category":
		conditions = append(conditions, "scope = 'category' AND category_id = ?")
		params = append(params, q.CategoryID)
	default:
		conditions = append(conditions, "(scope = 'public' OR (scope = 'category' AND category_id = ?))")
		params = append(params, q.CategoryID)
	}
	if q.PathSubstring != "" {
		// instr 而非 LIKE：路径子串中的 % 与 _ 必须按字面量处理。
		conditions = append(conditions, "instr(lower(path), lower(?)) > 0")
		params = append(params, q.PathSubstring)
	}
	if q.ExactPath != "" {
		conditions = append(conditions, "path = ?")
		params = append(params, q.ExactPath)
	}
	sqlText := fmt.Sprintf("SELECT %s FROM documents WHERE %s ORDER BY CASE WHEN scope = 'public' THEN 0 ELSE 1 END, path ASC",
		fields, strings.Join(conditions, " AND "))
	return queryMaps(handle, sqlText, params...)
}

// GetDocumentByID fetches one document by primary key, with its content.
func GetDocumentByID(handle *sql.DB, workspaceID, documentID string) (map[string]any, error) {
	rows, err := queryMaps(handle,
		fmt.Sprintf("SELECT %s FROM documents WHERE workspace_id = ? AND id = ?", documentFields),
		workspaceID, documentID)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// GetDocumentByPath fetches one document by scope and logical path, with its
// content. Scope "public" ignores categoryID.
func GetDocumentByPath(handle *sql.DB, workspaceID, scope, categoryID, path string) (map[string]any, error) {
	sqlText := fmt.Sprintf("SELECT %s FROM documents WHERE workspace_id = ? AND scope = 'public' AND path = ?", documentFields)
	params := []any{workspaceID, path}
	if scope != "public" {
		sqlText = fmt.Sprintf("SELECT %s FROM documents WHERE workspace_id = ? AND scope = 'category' AND category_id = ? AND path = ?", documentFields)
		params = []any{workspaceID, categoryID, path}
	}
	rows, err := queryMaps(handle, sqlText, params...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// CreateDocument inserts a document without overwriting anything: an existing
// path in the same scope returns "duplicate".
func CreateDocument(handle *sql.DB, workspaceID, scope, categoryID, path, content string) (map[string]any, string, error) {
	stamp := db.UtcNow()
	var category any
	if scope == "category" {
		category = categoryID
	}
	for attempt := 0; attempt < 3; attempt++ {
		documentID := ids.NewDocumentID()
		_, err := handle.Exec(
			"INSERT INTO documents (id, workspace_id, scope, category_id, path, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			documentID, workspaceID, scope, category, path, content, stamp, stamp)
		if err != nil {
			if !isUniqueViolation(err) {
				return nil, "", err
			}
			if strings.Contains(err.Error(), "documents.id") {
				continue
			}
			return nil, "duplicate", nil
		}
		document, err := GetDocumentByID(handle, workspaceID, documentID)
		return document, "created", err
	}
	return nil, "", fmt.Errorf("生成唯一文档 id 失败")
}

// OverwriteDocumentByPath replaces the content of an existing document in the
// current category. It never creates a document and never touches the public
// scope; a missing path returns "not_found".
func OverwriteDocumentByPath(handle *sql.DB, workspaceID, categoryID, path, content string) (map[string]any, string, error) {
	result, err := handle.Exec(
		"UPDATE documents SET content = ?, updated_at = ? WHERE workspace_id = ? AND scope = 'category' AND category_id = ? AND path = ?",
		content, db.UtcNow(), workspaceID, categoryID, path)
	if err != nil {
		return nil, "", err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, "", err
	}
	if affected == 0 {
		return nil, "not_found", nil
	}
	document, err := GetDocumentByPath(handle, workspaceID, "category", categoryID, path)
	return document, "updated", err
}

// EditDocumentByPath performs an exact-text replacement inside one exclusive
// write transaction: read, match-count check, replace and write back are
// atomic, so two concurrent partial edits cannot lose each other's change. It
// returns the replacement count plus "not_found", "empty_match", "no_match",
// "ambiguous" or "edited".
func EditDocumentByPath(handle *sql.DB, workspaceID, categoryID, path, oldString, newString string, replaceAll bool) (int, string, error) {
	if oldString == "" {
		return 0, "empty_match", nil
	}
	ctx := context.Background()
	conn, err := handle.Conn(ctx)
	if err != nil {
		return 0, "", err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return 0, "", err
	}
	rollback := func() { _, _ = conn.ExecContext(ctx, "ROLLBACK") }
	var content string
	err = conn.QueryRowContext(ctx,
		"SELECT content FROM documents WHERE workspace_id = ? AND scope = 'category' AND category_id = ? AND path = ?",
		workspaceID, categoryID, path).Scan(&content)
	if err == sql.ErrNoRows {
		rollback()
		return 0, "not_found", nil
	}
	if err != nil {
		rollback()
		return 0, "", err
	}
	count := strings.Count(content, oldString)
	if count == 0 {
		rollback()
		return 0, "no_match", nil
	}
	if count > 1 && !replaceAll {
		rollback()
		return count, "ambiguous", nil
	}
	replaced := strings.Replace(content, oldString, newString, 1)
	if replaceAll {
		replaced = strings.ReplaceAll(content, oldString, newString)
	}
	if _, err := conn.ExecContext(ctx,
		"UPDATE documents SET content = ?, updated_at = ? WHERE workspace_id = ? AND scope = 'category' AND category_id = ? AND path = ?",
		replaced, db.UtcNow(), workspaceID, categoryID, path); err != nil {
		rollback()
		return 0, "", err
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return 0, "", err
	}
	return count, "edited", nil
}

// DeleteDocumentByPath physically deletes a document of the current category.
func DeleteDocumentByPath(handle *sql.DB, workspaceID, categoryID, path string) (bool, error) {
	result, err := handle.Exec(
		"DELETE FROM documents WHERE workspace_id = ? AND scope = 'category' AND category_id = ? AND path = ?",
		workspaceID, categoryID, path)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// withImmediateTx runs fn inside an exclusive SQLite write transaction and
// rolls back unless fn returns commit == true with a nil error.
func withImmediateTx(handle *sql.DB, fn func(ctx context.Context, conn *sql.Conn) (bool, error)) error {
	ctx := context.Background()
	conn, err := handle.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	commit, err := fn(ctx, conn)
	if err != nil || !commit {
		_, _ = conn.ExecContext(ctx, "ROLLBACK")
		return err
	}
	_, err = conn.ExecContext(ctx, "COMMIT")
	return err
}

// MoveDocumentByPath renames or moves one document inside the current category,
// preserving id and created_at. It never touches the public scope. Returned
// statuses are "same_path", "not_found", "duplicate" or "moved".
func MoveDocumentByPath(handle *sql.DB, workspaceID, categoryID, oldPath, newPath string, overwrite bool) (string, error) {
	if oldPath == newPath {
		return "same_path", nil
	}
	if !overwrite {
		result, err := handle.Exec(
			"UPDATE documents SET path = ?, updated_at = ? WHERE workspace_id = ? AND scope = 'category' AND category_id = ? AND path = ?",
			newPath, db.UtcNow(), workspaceID, categoryID, oldPath)
		if err != nil {
			if isUniqueViolation(err) {
				return "duplicate", nil
			}
			return "", err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return "", err
		}
		if affected == 0 {
			return "not_found", nil
		}
		return "moved", nil
	}

	status := ""
	err := withImmediateTx(handle, func(ctx context.Context, conn *sql.Conn) (bool, error) {
		var sourceID string
		err := conn.QueryRowContext(ctx,
			"SELECT id FROM documents WHERE workspace_id = ? AND scope = 'category' AND category_id = ? AND path = ?",
			workspaceID, categoryID, oldPath).Scan(&sourceID)
		if err == sql.ErrNoRows {
			status = "not_found"
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if _, err := conn.ExecContext(ctx,
			"DELETE FROM documents WHERE workspace_id = ? AND scope = 'category' AND category_id = ? AND path = ?",
			workspaceID, categoryID, newPath); err != nil {
			return false, err
		}
		if _, err := conn.ExecContext(ctx,
			"UPDATE documents SET path = ?, updated_at = ? WHERE id = ?",
			newPath, db.UtcNow(), sourceID); err != nil {
			return false, err
		}
		status = "moved"
		return true, nil
	})
	return status, err
}

type docMoveEntry struct {
	id      string
	oldPath string
	newPath string
}

// MoveDocumentsByPrefix atomically moves every document under oldPrefix/ to
// newPrefix/ inside the current category. Returned statuses are "same_path",
// "into_self", "not_found", "invalid_path", "duplicate" or "moved".
func MoveDocumentsByPrefix(handle *sql.DB, workspaceID, categoryID, oldPrefix, newPrefix string, overwrite bool) (int, string, string, error) {
	if oldPrefix == newPrefix {
		return 0, "", "same_path", nil
	}
	oldSlash := oldPrefix + "/"
	if strings.HasPrefix(newPrefix, oldSlash) {
		return 0, "", "into_self", nil
	}

	movedCount := 0
	detail := ""
	status := ""
	err := withImmediateTx(handle, func(ctx context.Context, conn *sql.Conn) (bool, error) {
		// Range scan [prefix+"/", prefix+"0") relies on '/' (0x2f) + 1 == '0' (0x30)
		// to match slash boundaries cleanly without LIKE wildcards or UTF-8 rune mismatches.
		rows, err := conn.QueryContext(ctx,
			"SELECT id, path FROM documents WHERE workspace_id = ? AND scope = 'category' AND category_id = ? AND path >= ? AND path < ?",
			workspaceID, categoryID, oldSlash, oldPrefix+"0")
		if err != nil {
			return false, err
		}
		var moves []docMoveEntry
		movingIDs := map[string]bool{}
		for rows.Next() {
			var id, docPath string
			if err := rows.Scan(&id, &docPath); err != nil {
				rows.Close()
				return false, err
			}
			if !strings.HasPrefix(docPath, oldSlash) {
				continue
			}
			dest, msg := NormalizeDocPath(newPrefix + "/" + strings.TrimPrefix(docPath, oldSlash))
			if msg != "" {
				rows.Close()
				detail = msg
				status = "invalid_path"
				return false, nil
			}
			moves = append(moves, docMoveEntry{id: id, oldPath: docPath, newPath: dest})
			movingIDs[id] = true
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return false, err
		}
		rows.Close()

		if len(moves) == 0 {
			status = "not_found"
			return false, nil
		}

		// Moving a nested folder upward (e.g. a/b -> a when a/b/x.md and a/b/b/x.md
		// both exist) maps deeper files onto shallower source paths; shortest-first
		// updates vacate each shallower path before a deeper file moves into it.
		sort.Slice(moves, func(i, j int) bool {
			if len(moves[i].oldPath) != len(moves[j].oldPath) {
				return len(moves[i].oldPath) < len(moves[j].oldPath)
			}
			return moves[i].oldPath < moves[j].oldPath
		})

		targetRows, err := conn.QueryContext(ctx,
			"SELECT id, path FROM documents WHERE workspace_id = ? AND scope = 'category' AND category_id = ? AND path >= ? AND path < ?",
			workspaceID, categoryID, newPrefix+"/", newPrefix+"0")
		if err != nil {
			return false, err
		}
		externalByPath := map[string]string{}
		for targetRows.Next() {
			var id, docPath string
			if err := targetRows.Scan(&id, &docPath); err != nil {
				targetRows.Close()
				return false, err
			}
			if !movingIDs[id] {
				externalByPath[docPath] = id
			}
		}
		if err := targetRows.Err(); err != nil {
			targetRows.Close()
			return false, err
		}
		targetRows.Close()

		var deleteIDs []string
		for _, item := range moves {
			if targetID, clash := externalByPath[item.newPath]; clash {
				if !overwrite {
					detail = item.newPath
					status = "duplicate"
					return false, nil
				}
				deleteIDs = append(deleteIDs, targetID)
			}
		}
		for _, targetID := range deleteIDs {
			if _, err := conn.ExecContext(ctx, "DELETE FROM documents WHERE id = ?", targetID); err != nil {
				return false, err
			}
		}
		stamp := db.UtcNow()
		for _, item := range moves {
			if _, err := conn.ExecContext(ctx, "UPDATE documents SET path = ?, updated_at = ? WHERE id = ?",
				item.newPath, stamp, item.id); err != nil {
				return false, err
			}
		}
		movedCount = len(moves)
		status = "moved"
		return true, nil
	})
	return movedCount, detail, status, err
}

// UpdateDocumentByID edits a document addressed by primary key for the Web
// console: path rename and/or content save. It returns "not_found",
// "duplicate" or "updated" together with the refreshed document.
func UpdateDocumentByID(handle *sql.DB, workspaceID, documentID string, newPath *string, newContent *string) (map[string]any, string, error) {
	assignments := []string{}
	params := []any{}
	if newPath != nil {
		assignments = append(assignments, "path = ?")
		params = append(params, *newPath)
	}
	if newContent != nil {
		assignments = append(assignments, "content = ?")
		params = append(params, *newContent)
	}
	if len(assignments) == 0 {
		document, err := GetDocumentByID(handle, workspaceID, documentID)
		if err != nil || document == nil {
			return document, "not_found", err
		}
		return document, "unchanged", nil
	}
	assignments = append(assignments, "updated_at = ?")
	params = append(params, db.UtcNow(), workspaceID, documentID)
	result, err := handle.Exec(
		fmt.Sprintf("UPDATE documents SET %s WHERE workspace_id = ? AND id = ?", strings.Join(assignments, ", ")),
		params...)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, "duplicate", nil
		}
		return nil, "", err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, "", err
	}
	if affected == 0 {
		return nil, "not_found", nil
	}
	document, err := GetDocumentByID(handle, workspaceID, documentID)
	return document, "updated", err
}

// DeleteDocumentByID physically deletes a document addressed by primary key.
func DeleteDocumentByID(handle *sql.DB, workspaceID, documentID string) (bool, error) {
	result, err := handle.Exec("DELETE FROM documents WHERE workspace_id = ? AND id = ?", workspaceID, documentID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}
