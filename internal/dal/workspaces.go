package dal

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"capsa/internal/db"
	"capsa/internal/ids"
	"capsa/internal/permissions"
)

// workspaceFields is the shared projection for workspace rows, including the
// container counters the settings view renders.
const workspaceFields = `w.id, w.name, w.description, w.mode, w.shallow_months, w.created_at, w.updated_at,
       (SELECT COUNT(*) FROM groups g WHERE g.workspace_id = w.id) AS group_count,
       (SELECT COUNT(*) FROM doc_categories c WHERE c.workspace_id = w.id) AS category_count,
       (SELECT COUNT(*) FROM documents d WHERE d.workspace_id = w.id AND d.scope = 'public') AS public_doc_count`

// workspaceOrder keeps the default memory workspace first, then creation order.
const workspaceOrder = `ORDER BY CASE WHEN w.id = 'default' THEN 0 ELSE 1 END, w.created_at ASC, w.id ASC`

// ListWorkspaces returns every workspace with its container counters.
func ListWorkspaces(handle *sql.DB) ([]map[string]any, error) {
	return queryMaps(handle, fmt.Sprintf("SELECT %s FROM workspaces w %s", workspaceFields, workspaceOrder))
}

// GetWorkspaceMode fetches only the mode column of one workspace without
// evaluating container counter subqueries.
func GetWorkspaceMode(handle *sql.DB, workspaceID string) (string, bool, error) {
	var mode string
	err := handle.QueryRow("SELECT mode FROM workspaces WHERE id = ?", workspaceID).Scan(&mode)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return mode, true, nil
}

// GetWorkspace fetches one workspace, or nil when absent.
func GetWorkspace(handle *sql.DB, workspaceID string) (map[string]any, error) {
	rows, err := queryMaps(handle,
		fmt.Sprintf("SELECT %s FROM workspaces w WHERE w.id = ?", workspaceFields), workspaceID)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// CreateWorkspace inserts a workspace with a generated id, retrying a primary
// key clash at most three times, and returns the stored record.
func CreateWorkspace(handle *sql.DB, name, description, mode string, shallowMonths int) (map[string]any, error) {
	if mode != "memory" || shallowMonths <= 0 {
		shallowMonths = db.DefaultShallowMonths
	}
	stamp := db.UtcNow()
	for attempt := 0; attempt < 3; attempt++ {
		workspaceID := ids.NewWorkspaceID()
		_, err := handle.Exec(
			"INSERT INTO workspaces (id, name, description, mode, shallow_months, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			workspaceID, name, description, mode, shallowMonths, stamp, stamp)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE constraint failed") {
				continue
			}
			return nil, err
		}
		return GetWorkspace(handle, workspaceID)
	}
	return nil, fmt.Errorf("生成唯一工作区 id 失败")
}

// UpdateWorkspace edits name, description and optionally shallow_months. The
// mode is fixed at creation, so it is deliberately absent from the assignment list.
func UpdateWorkspace(handle *sql.DB, workspaceID, name, description string, shallowMonths *int) (bool, error) {
	var (
		result sql.Result
		err    error
	)
	if shallowMonths != nil {
		result, err = handle.Exec(
			"UPDATE workspaces SET name = ?, description = ?, shallow_months = ?, updated_at = ? WHERE id = ?",
			name, description, *shallowMonths, db.UtcNow(), workspaceID)
	} else {
		result, err = handle.Exec(
			"UPDATE workspaces SET name = ?, description = ?, updated_at = ? WHERE id = ?",
			name, description, db.UtcNow(), workspaceID)
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

// DeleteEmptyWorkspace removes a workspace holding no containers. The existence
// check and the emptiness check share one exclusive transaction so a concurrent
// container insert cannot slip between them. It returns "is_default",
// "not_found", "not_empty" or "deleted".
func DeleteEmptyWorkspace(handle *sql.DB, workspaceID string) (string, error) {
	if workspaceID == db.DefaultWorkspaceID {
		return "is_default", nil
	}
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
	var mode string
	if err := conn.QueryRowContext(ctx, "SELECT mode FROM workspaces WHERE id = ?", workspaceID).Scan(&mode); err != nil {
		if err == sql.ErrNoRows {
			rollback()
			return "not_found", nil
		}
		rollback()
		return "", err
	}
	var count int
	if mode == "memory" {
		err = conn.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM groups WHERE workspace_id = ?", workspaceID).Scan(&count)
	} else {
		err = conn.QueryRowContext(ctx, `
		    SELECT (SELECT COUNT(*) FROM doc_categories WHERE workspace_id = ?)
		         + (SELECT COUNT(*) FROM documents WHERE workspace_id = ?)`,
			workspaceID, workspaceID).Scan(&count)
	}
	if err != nil {
		rollback()
		return "", err
	}
	if count > 0 {
		rollback()
		return "not_empty", nil
	}
	if _, err := conn.ExecContext(ctx, "DELETE FROM workspaces WHERE id = ?", workspaceID); err != nil {
		rollback()
		return "", err
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return "", err
	}
	return "deleted", nil
}

// AddGroupInWorkspace inserts a group into a memory workspace. It returns
// "workspace_not_found", "wrong_mode", "duplicate" or "inserted". The slug
// stays globally unique: keys and the workspace-less MCP tools address groups
// by slug alone, so a duplicate across memory workspaces must be refused.
func AddGroupInWorkspace(handle *sql.DB, workspaceID, slug, name, description string) (string, error) {
	workspace, err := GetWorkspace(handle, workspaceID)
	if err != nil {
		return "", err
	}
	if workspace == nil {
		return "workspace_not_found", nil
	}
	if workspace["mode"] != "memory" {
		return "wrong_mode", nil
	}
	result, err := handle.Exec(
		"INSERT OR IGNORE INTO groups (slug, workspace_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)",
		slug, workspaceID, name, description, db.UtcNow())
	if err != nil {
		return "", err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return "", err
	}
	if affected == 0 {
		return "duplicate", nil
	}
	return "inserted", nil
}

// ListGroupsInWorkspace lists groups ordered by slug; an empty workspaceID
// means every group.
func ListGroupsInWorkspace(handle *sql.DB, workspaceID string) ([]map[string]any, error) {
	sqlText := "SELECT slug, workspace_id, name, description FROM groups"
	params := []any{}
	if workspaceID != "" {
		sqlText += " WHERE workspace_id = ?"
		params = append(params, workspaceID)
	}
	return queryMaps(handle, sqlText+" ORDER BY slug", params...)
}

// ListGroupsWithCountsInWorkspace lists groups visible to the scopes with their
// active memory count, effective permission and owning workspace.
func ListGroupsWithCountsInWorkspace(handle *sql.DB, scopes map[string]string, workspaceID string) ([]map[string]any, error) {
	_, wildcard := scopes["*"]
	slugs := sortedKeys(scopes)
	if !wildcard && len(slugs) == 0 {
		return []map[string]any{}, nil
	}
	conditions := []string{}
	params := []any{}
	if !wildcard {
		conditions = append(conditions, fmt.Sprintf("g.slug IN (%s)", placeholders(len(slugs))))
		for _, slug := range slugs {
			params = append(params, slug)
		}
	}
	if workspaceID != "" {
		conditions = append(conditions, "g.workspace_id = ?")
		params = append(params, workspaceID)
	}
	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}
	rows, err := queryMaps(handle, fmt.Sprintf(`
        SELECT g.slug, g.workspace_id, g.name, g.description,
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
