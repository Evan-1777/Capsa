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
	"unicode/utf8"

	"capsa/internal/db"
	"capsa/internal/ids"
	"capsa/internal/permissions"
)

// Shared SQL fragments for memory queries carrying workspace shallow_months.
const (
	memoryJoin           = "memories m JOIN groups g ON g.slug = m.group_slug JOIN workspaces w ON w.id = g.workspace_id"
	memoryBaseFields     = "m.id, m.group_slug, m.title, m.summary, m.tags, m.pinned, m.expires_at, m.created_at, m.updated_at, m.deleted_at, m.deleted_reason, w.shallow_months"
	memoryWithBodyFields = memoryBaseFields + ", m.body"
	memoryUnifiedOrder   = "ORDER BY CASE WHEN m.pinned != 0 THEN 0 WHEN m.expires_at IS NOT NULL THEN 1 ELSE 2 END ASC, m.updated_at DESC, m.id DESC"
)

// WebListFields is the public list projection: internal columns (pinned,
// shallow_months) are queried in SQL for tier derivation but excluded here so
// JSON responses never leak them.
var WebListFields = []string{
	"id", "group_slug", "title", "summary", "tags", "expires_at",
	"updated_at", "deleted_at", "deleted_reason",
}

// WebItemFields is the public detail projection, which additionally carries body.
var WebItemFields = []string{
	"id", "group_slug", "title", "summary", "body", "tags", "expires_at",
	"created_at", "updated_at", "deleted_at", "deleted_reason",
}

var memoryUpdateFields = map[string]bool{
	"title": true, "summary": true, "body": true,
	"tags": true, "pinned": true, "expires_at": true,
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

// ArchiveExpiredMemories lazily moves expired temporary memories into the
// recycle bin. A fast index-only probe avoids acquiring a write lock on the
// common path where nothing has expired.
func ArchiveExpiredMemories(handle *sql.DB, now string) (int64, error) {
	var one int
	err := handle.QueryRow(
		"SELECT 1 FROM memories WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ? LIMIT 1",
		now).Scan(&one)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	result, err := handle.Exec(
		"UPDATE memories SET deleted_at = ?, deleted_reason = '临时记忆到期自动归档' WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?",
		now, now)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// GetMemoriesBatchForAccess applies the three-state judgement to each requested
// id, preserving the order they were given in. When includeDeleted is true,
// recycle-bin entries are also resolved under the same three-state masking.
func GetMemoriesBatchForAccess(handle *sql.DB, memoryIDs []string, scopes map[string]string, includeDeleted bool) ([]map[string]any, error) {
	if len(memoryIDs) == 0 {
		return []map[string]any{}, nil
	}
	params := make([]any, len(memoryIDs))
	for i, id := range memoryIDs {
		params[i] = id
	}
	deletedFilter := " AND m.deleted_at IS NULL"
	if includeDeleted {
		deletedFilter = ""
	}
	rows, err := queryMaps(handle,
		fmt.Sprintf("SELECT %s FROM %s WHERE m.id IN (%s)%s",
			memoryWithBodyFields, memoryJoin, placeholders(len(memoryIDs)), deletedFilter), params...)
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
			// 只允许返回 status 与 id：携带 group_slug 会泄露未授权组别名。
			results = append(results, map[string]any{"status": "forbidden", "id": id})
		}
	}
	return results, nil
}

// ListActiveTitlesByGroup projects only id and title for active entries in one
// group, avoiding full metadata reads during title-similarity checks.
func ListActiveTitlesByGroup(handle *sql.DB, group string) ([]map[string]any, error) {
	return queryMaps(handle,
		"SELECT id, title FROM memories WHERE deleted_at IS NULL AND group_slug = ?", group)
}

// ListMemoriesForCatalogAndSearch returns authorized memories covering active
// and/or deleted entries in unified order; body is projected only when
// includeBody is true.
func ListMemoriesForCatalogAndSearch(handle *sql.DB, scopes map[string]string, workspaceID, group string, includeActive, includeDeleted, includeBody bool) ([]map[string]any, error) {
	_, wildcard := scopes["*"]
	slugs := sortedKeys(scopes)
	if (!wildcard && len(slugs) == 0) || (!includeActive && !includeDeleted) {
		return []map[string]any{}, nil
	}
	conditions := []string{}
	params := []any{}
	if !wildcard {
		conditions = append(conditions, fmt.Sprintf("m.group_slug IN (%s)", placeholders(len(slugs))))
		for _, slug := range slugs {
			params = append(params, slug)
		}
	}
	if workspaceID != "" {
		conditions = append(conditions, "g.workspace_id = ?")
		params = append(params, workspaceID)
	}
	if group != "" {
		conditions = append(conditions, "m.group_slug = ?")
		params = append(params, group)
	}
	if includeActive && !includeDeleted {
		conditions = append(conditions, "m.deleted_at IS NULL")
	} else if !includeActive && includeDeleted {
		conditions = append(conditions, "m.deleted_at IS NOT NULL")
	}
	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}
	fields := memoryBaseFields
	if includeBody {
		fields = memoryWithBodyFields
	}
	sqlText := fmt.Sprintf("SELECT %s FROM %s %s %s", fields, memoryJoin, where, memoryUnifiedOrder)
	return queryMaps(handle, sqlText, params...)
}

// AddGroup inserts a group into the default memory workspace; false means the
// slug already exists.
func AddGroup(handle *sql.DB, slug, name, description string) (bool, error) {
	status, err := AddGroupInWorkspace(handle, db.DefaultWorkspaceID, slug, name, description)
	if err != nil {
		return false, err
	}
	switch status {
	case "inserted":
		return true, nil
	case "duplicate":
		return false, nil
	default:
		return false, fmt.Errorf("新增分组 %s 失败：%s", slug, status)
	}
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
	rows, err := queryMaps(handle, "SELECT slug, workspace_id, name, description, created_at FROM groups WHERE slug = ?", slug)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// ListGroups lists every group ordered by slug.
func ListGroups(handle *sql.DB) ([]map[string]any, error) {
	return ListGroupsInWorkspace(handle, "")
}

// ListGroupsWithCounts lists groups visible to the scopes with their active
// memory count and the effective permission.
func ListGroupsWithCounts(handle *sql.DB, scopes map[string]string) ([]map[string]any, error) {
	return ListGroupsWithCountsInWorkspace(handle, scopes, "")
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
		"SELECT id, name, scopes, last_used_at FROM keys WHERE token_hash = ? AND revoked_at IS NULL", tokenHash)
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

// UpdateKey updates name and scopes of an active key without changing its
// token_hash. It returns "not_found", "already_revoked" or "updated".
func UpdateKey(handle *sql.DB, keyID, name string, scopes map[string]string) (string, error) {
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
	encoded, err := json.Marshal(scopes)
	if err != nil {
		return "", err
	}
	if _, err := handle.Exec("UPDATE keys SET name = ?, scopes = ? WHERE id = ?", name, string(encoded), keyID); err != nil {
		return "", err
	}
	return "updated", nil
}

// InsertMemory inserts an entry. A generated id retries on a primary key clash;
// a caller-supplied id fails immediately with DuplicateMemoryIDError.
func InsertMemory(handle *sql.DB, groupSlug, title, summary, body string, tags []string, persistent bool, expiresAt *string, memoryID *string) (string, error) {
	stamp := db.UtcNow()
	if tags == nil {
		tags = []string{}
	}
	encoded, err := json.Marshal(tags)
	if err != nil {
		return "", err
	}
	pinnedVal := 0
	if persistent {
		pinnedVal = 1
	}
	candidate := memoryID
	lastID := ""
	for attempt := 0; attempt < 3; attempt++ {
		var current string
		if candidate != nil {
			current = *candidate
		} else {
			current = ids.NewMemoryID()
		}
		lastID = current
		_, err := handle.Exec(
			"INSERT INTO memories (id, group_slug, title, summary, body, tags, pinned, expires_at,"+
				" created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			current, groupSlug, title, summary, body, string(encoded), pinnedVal, expiresAt, stamp, stamp)
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
	return "", DuplicateMemoryIDError{ID: lastID}
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

// RestoreMemory restores a soft-deleted entry. When newExpiresAt is non-nil it
// atomically clears pinned=0 and sets expires_at to preserve the persistent vs
// temporary exclusivity invariant; otherwise any already-expired expires_at is
// automatically cleared so the entry stays active.
func RestoreMemory(handle *sql.DB, memoryID string, newExpiresAt *string, now string) (bool, error) {
	var (
		result sql.Result
		err    error
	)
	if newExpiresAt != nil {
		result, err = handle.Exec(
			"UPDATE memories SET pinned = 0, expires_at = ?, deleted_at = NULL, deleted_reason = NULL WHERE id = ? AND deleted_at IS NOT NULL",
			*newExpiresAt, memoryID)
	} else {
		result, err = handle.Exec(
			"UPDATE memories SET deleted_at = NULL, deleted_reason = NULL, expires_at = CASE WHEN expires_at IS NOT NULL AND expires_at <= ? THEN NULL ELSE expires_at END WHERE id = ? AND deleted_at IS NOT NULL",
			now, memoryID)
	}
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// PurgeMemory permanently deletes a single entry from the recycle bin.
func PurgeMemory(handle *sql.DB, memoryID string) (bool, error) {
	result, err := handle.Exec(
		"DELETE FROM memories WHERE id = ? AND deleted_at IS NOT NULL", memoryID)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// EmptyTrashMemories permanently deletes recycle-bin entries inside the
// caller's writable group scope (optionally narrowed by workspaceID / group).
func EmptyTrashMemories(handle *sql.DB, writableSlugs []string, wildcardWrite bool, workspaceID, group string) (int64, error) {
	if !wildcardWrite && len(writableSlugs) == 0 {
		return 0, nil
	}
	conditions := []string{"deleted_at IS NOT NULL"}
	params := []any{}
	if !wildcardWrite {
		conditions = append(conditions, fmt.Sprintf("group_slug IN (%s)", placeholders(len(writableSlugs))))
		params = append(params, stringSliceToAny(writableSlugs)...)
	}
	if workspaceID != "" {
		conditions = append(conditions, "group_slug IN (SELECT slug FROM groups WHERE workspace_id = ?)")
		params = append(params, workspaceID)
	}
	if group != "" {
		conditions = append(conditions, "group_slug = ?")
		params = append(params, group)
	}
	result, err := handle.Exec(
		fmt.Sprintf("DELETE FROM memories WHERE %s", strings.Join(conditions, " AND ")), params...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// EditMemoryBody performs an atomic exact-text replacement on an active memory
// body inside an exclusive write transaction. It returns the replacement count
// and status: "empty_match", "not_found", "no_match", "ambiguous",
// "empty_body", "body_too_long" or "edited".
func EditMemoryBody(handle *sql.DB, memoryID, oldString, newString string, replaceAll bool, bodyMax int) (int, string, error) {
	if oldString == "" {
		return 0, "empty_match", nil
	}
	count := 0
	status := ""
	err := withImmediateTx(handle, func(ctx context.Context, conn *sql.Conn) (bool, error) {
		var body string
		err := conn.QueryRowContext(ctx,
			"SELECT body FROM memories WHERE id = ? AND deleted_at IS NULL", memoryID).Scan(&body)
		if err == sql.ErrNoRows {
			status = "not_found"
			return false, nil
		}
		if err != nil {
			return false, err
		}
		count = strings.Count(body, oldString)
		if count == 0 {
			status = "no_match"
			return false, nil
		}
		if count > 1 && !replaceAll {
			status = "ambiguous"
			return false, nil
		}
		replaced := strings.Replace(body, oldString, newString, 1)
		if replaceAll {
			replaced = strings.ReplaceAll(body, oldString, newString)
		}
		if strings.TrimSpace(replaced) == "" {
			status = "empty_body"
			return false, nil
		}
		if utf8.RuneCountInString(replaced) > bodyMax {
			status = "body_too_long"
			return false, nil
		}
		if _, err := conn.ExecContext(ctx,
			"UPDATE memories SET body = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
			replaced, db.UtcNow(), memoryID); err != nil {
			return false, err
		}
		status = "edited"
		return true, nil
	})
	return count, status, err
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

// ListMemoriesForWeb pages active / deleted entries inside the authorized
// groups in unified order.
func ListMemoriesForWeb(handle *sql.DB, scopes map[string]string, status, tier, group string, offset, limit int) ([]map[string]any, int, error) {
	return ListMemoriesForWebInWorkspace(handle, scopes, "", status, tier, group, offset, limit)
}

// ListMemoriesForWebInWorkspace narrows the page to one memory workspace when
// workspaceID is non-empty. SQL handles persistent / temporary tier filters;
// shallow / deep filtering belongs to the service layer via retrieval.ComputeTier.
func ListMemoriesForWebInWorkspace(handle *sql.DB, scopes map[string]string, workspaceID, status, tier, group string, offset, limit int) ([]map[string]any, int, error) {
	_, wildcard := scopes["*"]
	slugs := sortedKeys(scopes)
	if !wildcard && len(slugs) == 0 {
		return []map[string]any{}, 0, nil
	}
	conditions := []string{}
	params := []any{}
	if !wildcard {
		conditions = append(conditions, fmt.Sprintf("m.group_slug IN (%s)", placeholders(len(slugs))))
		params = append(params, stringSliceToAny(slugs)...)
	}
	if workspaceID != "" {
		conditions = append(conditions, "g.workspace_id = ?")
		params = append(params, workspaceID)
	}
	if status == "deleted" {
		conditions = append(conditions, "m.deleted_at IS NOT NULL")
	} else {
		conditions = append(conditions, "m.deleted_at IS NULL")
		switch tier {
		case "persistent":
			conditions = append(conditions, "m.pinned != 0")
		case "temporary":
			conditions = append(conditions, "m.pinned = 0 AND m.expires_at IS NOT NULL")
		}
	}
	if group != "" {
		conditions = append(conditions, "m.group_slug = ?")
		params = append(params, group)
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := handle.QueryRow(
		fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s", memoryJoin, where), params...).Scan(&total); err != nil {
		return nil, 0, err
	}
	pageParams := append(append([]any{}, params...), limit, offset)
	rows, err := queryMaps(handle,
		fmt.Sprintf("SELECT %s FROM %s WHERE %s %s LIMIT ? OFFSET ?",
			memoryBaseFields, memoryJoin, where, memoryUnifiedOrder), pageParams...)
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// GetMemoryForWeb fetches one entry without filtering deleted_at so the recycle
// bin can locate it.
func GetMemoryForWeb(handle *sql.DB, memoryID string) (map[string]any, error) {
	rows, err := queryMaps(handle,
		fmt.Sprintf("SELECT %s FROM %s WHERE m.id = ?", memoryWithBodyFields, memoryJoin), memoryID)
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
	rows, err := queryMaps(handle, "SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM keys WHERE id = ?", keyID)
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
