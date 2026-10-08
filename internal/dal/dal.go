// Package dal is the only module that issues SQL. Rows are returned as
// map[string]any so the transport layers can shape JSON without extra mapping
// structs; this mirrors the dict-based contract of the original Python layer.
package dal

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"capsa/internal/db"
	"capsa/internal/ids"
	"capsa/internal/permissions"
)

// Column projections, aligned with capsa/dal.py.
const (
	memoryReadFields           = "id, group_slug, title, summary, body, tags, review_at, pinned, created_at, updated_at"
	memorySearchFields         = "id, group_slug, title, summary, tags, review_at, pinned, updated_at"
	memorySearchWithBodyFields = memorySearchFields + ", body"
)

// WebListFields is the list projection: always carries the recycle-bin columns.
var WebListFields = []string{
	"id", "group_slug", "title", "summary", "tags", "review_at", "pinned",
	"updated_at", "deleted_at", "deleted_reason",
}

// WebItemFields is the detail projection, which additionally carries the body.
var WebItemFields = []string{
	"id", "group_slug", "title", "summary", "body", "tags", "review_at",
	"pinned", "created_at", "updated_at", "deleted_at", "deleted_reason",
}

var memoryUpdateFields = map[string]bool{
	"title": true, "summary": true, "body": true,
	"tags": true, "review_at": true, "pinned": true,
}

// DuplicateMemoryIDError is raised when every generated memory id collided with
// an existing primary key, or when a caller-supplied id collides.
type DuplicateMemoryIDError struct {
	ID string
}

func (e DuplicateMemoryIDError) Error() string {
	return fmt.Sprintf("duplicate memory id: %s", e.ID)
}

func placeholders(count int) string {
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

// queryMaps runs a query and materializes every row into a map keyed by column.
func queryMaps(handle *sql.DB, sqlText string, params ...any) ([]map[string]any, error) {
	rows, err := handle.Query(sqlText, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		targets := make([]any, len(columns))
		for i := range values {
			targets[i] = &values[i]
		}
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for i, column := range columns {
			if raw, ok := values[i].([]byte); ok {
				item[column] = string(raw)
			} else {
				item[column] = values[i]
			}
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func decodeScopes(raw string) map[string]string {
	scopes := map[string]string{}
	if raw == "" {
		return scopes
	}
	_ = json.Unmarshal([]byte(raw), &scopes)
	return scopes
}

// GetMemoriesBatchForAccess applies the three-state judgement to each requested
// id, preserving the order they were given in.
func GetMemoriesBatchForAccess(handle *sql.DB, memoryIDs []string, scopes map[string]string) ([]map[string]any, error) {
	if len(memoryIDs) == 0 {
		return []map[string]any{}, nil
	}
	params := make([]any, len(memoryIDs))
	for i, id := range memoryIDs {
		params[i] = id
	}
	rows, err := queryMaps(handle,
		fmt.Sprintf("SELECT %s FROM memories WHERE id IN (%s) AND deleted_at IS NULL",
			memoryReadFields, placeholders(len(memoryIDs))), params...)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]map[string]any, len(rows))
	for _, row := range rows {
		byID[row["id"].(string)] = row
	}
	results := make([]map[string]any, 0, len(memoryIDs))
	for _, id := range memoryIDs {
		row, found := byID[id]
		switch {
		case !found:
			results = append(results, map[string]any{"status": "not_found", "id": id})
		case permissions.PermissionFor(scopes, row["group_slug"].(string)) != "":
			item := map[string]any{"status": "authorized"}
			for key, value := range row {
				item[key] = value
			}
			results = append(results, item)
		default:
			// 只允许返回 status 与 id：携带 group_slug 会泄露未授权分组名。
			results = append(results, map[string]any{"status": "forbidden", "id": id})
		}
	}
	return results, nil
}

// ListActiveMemoriesForSearch returns active entries inside the authorized
// groups; body is projected only when includeBody is true.
func ListActiveMemoriesForSearch(handle *sql.DB, scopes map[string]string, group string, includeBody bool) ([]map[string]any, error) {
	_, wildcard := scopes["*"]
	slugs := sortedKeys(scopes)
	if !wildcard && len(slugs) == 0 {
		return []map[string]any{}, nil
	}
	conditions := []string{"deleted_at IS NULL"}
	params := []any{}
	if !wildcard {
		conditions = append(conditions, fmt.Sprintf("group_slug IN (%s)", placeholders(len(slugs))))
		for _, slug := range slugs {
			params = append(params, slug)
		}
	}
	if group != "" {
		conditions = append(conditions, "group_slug = ?")
		params = append(params, group)
	}
	fields := memorySearchFields
	if includeBody {
		fields = memorySearchWithBodyFields
	}
	sqlText := fmt.Sprintf("SELECT %s FROM memories WHERE %s", fields, strings.Join(conditions, " AND "))
	return queryMaps(handle, sqlText, params...)
}

// AddGroup inserts a group; false means the slug already exists.
func AddGroup(handle *sql.DB, slug, name, description string) (bool, error) {
	result, err := handle.Exec(
		"INSERT OR IGNORE INTO groups (slug, name, description, created_at) VALUES (?, ?, ?, ?)",
		slug, name, description, db.UtcNow())
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// UpdateGroup renames a group in place; the slug is immutable.
func UpdateGroup(handle *sql.DB, slug, name, description string) (bool, error) {
	result, err := handle.Exec(
		"UPDATE groups SET name = ?, description = ? WHERE slug = ?", name, description, slug)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// DeleteEmptyGroup atomically deletes a group when it has no memories, including
// recycled ones. It returns "not_found", "has_memories" or "deleted".
func DeleteEmptyGroup(handle *sql.DB, slug string) (string, error) {
	ctx := context.Background()
	conn, err := handle.Conn(ctx)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return "", err
	}
	rollback := func() {
		_, _ = conn.ExecContext(ctx, "ROLLBACK")
	}
	var exists int
	if err := conn.QueryRowContext(ctx, "SELECT 1 FROM groups WHERE slug = ?", slug).Scan(&exists); err != nil {
		if err == sql.ErrNoRows {
			rollback()
			return "not_found", nil
		}
		rollback()
		return "", err
	}
	var count int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM memories WHERE group_slug = ?", slug).Scan(&count); err != nil {
		rollback()
		return "", err
	}
	if count > 0 {
		rollback()
		return "has_memories", nil
	}
	if _, err := conn.ExecContext(ctx, "DELETE FROM groups WHERE slug = ?", slug); err != nil {
		rollback()
		return "", err
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return "", err
	}
	return "deleted", nil
}

// GetGroup fetches a single group, or nil when absent.
func GetGroup(handle *sql.DB, slug string) (map[string]any, error) {
	rows, err := queryMaps(handle, "SELECT slug, name, description, created_at FROM groups WHERE slug = ?", slug)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// ListGroups lists every group ordered by slug.
func ListGroups(handle *sql.DB) ([]map[string]any, error) {
	return queryMaps(handle, "SELECT slug, name, description FROM groups ORDER BY slug")
}

// ListGroupsWithCounts lists groups visible to the scopes with their active
// memory count and the effective permission.
func ListGroupsWithCounts(handle *sql.DB, scopes map[string]string) ([]map[string]any, error) {
	_, wildcard := scopes["*"]
	slugs := sortedKeys(scopes)
	if !wildcard && len(slugs) == 0 {
		return []map[string]any{}, nil
	}
	where, params := "", []any{}
	if !wildcard {
		where = fmt.Sprintf("WHERE g.slug IN (%s)", placeholders(len(slugs)))
		for _, slug := range slugs {
			params = append(params, slug)
		}
	}
	rows, err := queryMaps(handle, fmt.Sprintf(`
        SELECT g.slug, g.name, g.description,
               (SELECT COUNT(*) FROM memories m
                 WHERE m.group_slug = g.slug AND m.deleted_at IS NULL) AS count
        FROM groups g
        %s
        ORDER BY g.slug
        `, where), params...)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		row["permission"] = permissions.PermissionFor(scopes, row["slug"].(string))
	}
	return rows, nil
}

// CreateKey stores a signed key.
func CreateKey(handle *sql.DB, keyID, name, tokenHash string, scopes map[string]string) error {
	encoded, err := json.Marshal(scopes)
	if err != nil {
		return err
	}
	_, err = handle.Exec(
		"INSERT INTO keys (id, name, token_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)",
		keyID, name, tokenHash, string(encoded), db.UtcNow())
	return err
}

// FindActiveKeyByHash returns the key matching a token hash, or nil when absent
// or revoked.
func FindActiveKeyByHash(handle *sql.DB, tokenHash string) (map[string]any, error) {
	rows, err := queryMaps(handle,
		"SELECT id, name, scopes FROM keys WHERE token_hash = ? AND revoked_at IS NULL", tokenHash)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	row := rows[0]
	row["scopes"] = decodeScopes(row["scopes"].(string))
	return row, nil
}

// RevokeKey revokes an active key. It returns "not_found", "already_revoked" or
// "revoked".
func RevokeKey(handle *sql.DB, keyID string) (string, error) {
	var revokedAt sql.NullString
	err := handle.QueryRow("SELECT revoked_at FROM keys WHERE id = ?", keyID).Scan(&revokedAt)
	if err == sql.ErrNoRows {
		return "not_found", nil
	}
	if err != nil {
		return "", err
	}
	if revokedAt.Valid {
		return "already_revoked", nil
	}
	if _, err := handle.Exec("UPDATE keys SET revoked_at = ? WHERE id = ?", db.UtcNow(), keyID); err != nil {
		return "", err
	}
	return "revoked", nil
}

// DeleteRevokedKey deletes a revoked key. It returns "not_found", "still_active"
// or "deleted".
func DeleteRevokedKey(handle *sql.DB, keyID string) (string, error) {
	var revokedAt sql.NullString
	err := handle.QueryRow("SELECT revoked_at FROM keys WHERE id = ?", keyID).Scan(&revokedAt)
	if err == sql.ErrNoRows {
		return "not_found", nil
	}
	if err != nil {
		return "", err
	}
	if !revokedAt.Valid {
		return "still_active", nil
	}
	if _, err := handle.Exec("DELETE FROM keys WHERE id = ?", keyID); err != nil {
		return "", err
	}
	return "deleted", nil
}

// ListKeys lists every key ordered by creation time then id.
func ListKeys(handle *sql.DB) ([]map[string]any, error) {
	rows, err := queryMaps(handle,
		"SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM keys ORDER BY created_at, id")
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		row["scopes"] = decodeScopes(row["scopes"].(string))
	}
	return rows, nil
}

// TouchLastUsedAt records the last access of a key.
func TouchLastUsedAt(handle *sql.DB, keyID string) error {
	_, err := handle.Exec("UPDATE keys SET last_used_at = ? WHERE id = ?", db.UtcNow(), keyID)
	return err
}

// InsertMemory inserts an entry. A generated id retries on a primary key clash;
// a caller-supplied id fails immediately with DuplicateMemoryIDError.
func InsertMemory(handle *sql.DB, groupSlug, title, summary, body string, tags []string, reviewAt *string, memoryID *string) (string, error) {
	stamp := db.UtcNow()
	if tags == nil {
		tags = []string{}
	}
	encoded, err := json.Marshal(tags)
	if err != nil {
		return "", err
	}
	candidate := memoryID
	for attempt := 0; attempt < 3; attempt++ {
		var current string
		if candidate != nil {
			current = *candidate
		} else {
			current = ids.NewMemoryID()
		}
		_, err := handle.Exec(
			"INSERT INTO memories (id, group_slug, title, summary, body, tags, review_at,"+
				" created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			current, groupSlug, title, summary, body, string(encoded), reviewAt, stamp, stamp)
		if err != nil {
			if !strings.Contains(err.Error(), "UNIQUE constraint failed") {
				return "", err
			}
			if memoryID != nil {
				return "", DuplicateMemoryIDError{ID: current}
			}
			continue
		}
		return current, nil
	}
	return "", DuplicateMemoryIDError{ID: *candidate}
}

// UpdateMemory updates the whitelisted columns only; an empty mapping is a
// no-op. It reports whether a row was updated.
func UpdateMemory(handle *sql.DB, memoryID string, fields map[string]any) (bool, error) {
	changes := map[string]any{}
	keys := []string{}
	for key, value := range fields {
		if memoryUpdateFields[key] {
			changes[key] = value
			keys = append(keys, key)
		}
	}
	if len(keys) == 0 {
		return false, nil
	}
	// Deterministic assignment order keeps the generated SQL stable.
	sort.Strings(keys)
	assignments := make([]string, 0, len(keys))
	params := make([]any, 0, len(keys)+2)
	for _, key := range keys {
		value := changes[key]
		if key == "tags" {
			encoded, err := json.Marshal(normalizeTags(value))
			if err != nil {
				return false, err
			}
			value = string(encoded)
		}
		assignments = append(assignments, key+" = ?")
		params = append(params, value)
	}
	params = append(params, db.UtcNow(), memoryID)
	result, err := handle.Exec(
		fmt.Sprintf("UPDATE memories SET %s, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
			strings.Join(assignments, ", ")), params...)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

func normalizeTags(value any) []string {
	switch typed := value.(type) {
	case nil:
		return []string{}
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	default:
		return []string{}
	}
}

// SoftDeleteMemory soft-deletes an entry, only when still active.
func SoftDeleteMemory(handle *sql.DB, memoryID, reason string) (bool, error) {
	result, err := handle.Exec(
		"UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ? AND deleted_at IS NULL",
		db.UtcNow(), reason, memoryID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// RestoreMemory restores a soft-deleted entry, only when currently deleted.
func RestoreMemory(handle *sql.DB, memoryID string) (bool, error) {
	result, err := handle.Exec(
		"UPDATE memories SET deleted_at = NULL, deleted_reason = NULL WHERE id = ? AND deleted_at IS NOT NULL",
		memoryID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// ListDeletedMemories lists recycle-bin entries ordered by deletion time.
func ListDeletedMemories(handle *sql.DB, groupSlug string) ([]map[string]any, error) {
	sqlText := "SELECT id, group_slug, title, deleted_at, deleted_reason FROM memories WHERE deleted_at IS NOT NULL"
	params := []any{}
	if groupSlug != "" {
		sqlText += " AND group_slug = ?"
		params = append(params, groupSlug)
	}
	return queryMaps(handle, sqlText+" ORDER BY deleted_at DESC, id DESC", params...)
}

// ListMemoriesForWeb pages active / overdue / deleted entries inside the
// authorized groups, ordered by (pinned DESC, updated_at DESC, id DESC).
// Keyword matching is deliberately absent: hits and ordering belong to retrieval.
func ListMemoriesForWeb(handle *sql.DB, scopes map[string]string, status, group string, offset, limit int) ([]map[string]any, int, error) {
	_, wildcard := scopes["*"]
	slugs := sortedKeys(scopes)
	if !wildcard && len(slugs) == 0 {
		return []map[string]any{}, 0, nil
	}
	var condition string
	params := []any{}
	switch status {
	case "active":
		condition = "deleted_at IS NULL"
	case "deleted":
		condition = "deleted_at IS NOT NULL"
	default:
		condition = "deleted_at IS NULL AND review_at IS NOT NULL AND review_at < ?"
		params = append(params, db.UtcNow())
	}
	scoped := ""
	if !wildcard {
		scoped = fmt.Sprintf("group_slug IN (%s) AND ", placeholders(len(slugs)))
		// 占位符顺序由 scoped 决定，分组 slug 必须排在状态条件之前。
		params = append(append([]any{}, stringSliceToAny(slugs)...), params...)
	}
	where := scoped + condition
	if group != "" {
		where += " AND group_slug = ?"
	}
	countParams := append([]any{}, params...)
	if group != "" {
		countParams = append(countParams, group)
	}
	var total int
	if err := handle.QueryRow(
		fmt.Sprintf("SELECT COUNT(*) FROM memories WHERE %s", where), countParams...).Scan(&total); err != nil {
		return nil, 0, err
	}
	pageParams := append([]any{}, countParams...)
	pageParams = append(pageParams, limit, offset)
	rows, err := queryMaps(handle,
		fmt.Sprintf("SELECT %s FROM memories WHERE %s ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT ? OFFSET ?",
			strings.Join(WebListFields, ", "), where), pageParams...)
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// GetMemoryForWeb fetches one entry without filtering deleted_at so the recycle
// bin can locate it.
func GetMemoryForWeb(handle *sql.DB, memoryID string) (map[string]any, error) {
	rows, err := queryMaps(handle,
		fmt.Sprintf("SELECT %s FROM memories WHERE id = ?", strings.Join(WebItemFields, ", ")), memoryID)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// GetKey returns a key by id. When the admin token is configured, the virtual
// admin identity exists without a database row.
func GetKey(handle *sql.DB, keyID string) (map[string]any, error) {
	if keyID == permissions.AdminKeyID && permissions.AdminToken() != "" {
		return map[string]any{"id": permissions.AdminKeyID, "name": "Admin", "scopes": permissions.AdminGrants}, nil
	}
	rows, err := queryMaps(handle, "SELECT id, name, scopes FROM keys WHERE id = ?", keyID)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	row := rows[0]
	row["scopes"] = decodeScopes(row["scopes"].(string))
	return row, nil
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func stringSliceToAny(values []string) []any {
	out := make([]any, len(values))
	for i, value := range values {
		out[i] = value
	}
	return out
}
