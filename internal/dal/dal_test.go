package dal

import (
	"database/sql"
	"path/filepath"
	"testing"

	"capsa/internal/db"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	t.Setenv("CAPSA_DB_PATH", filepath.Join(t.TempDir(), "capsa.db"))
	handle, err := db.Connect()
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := db.InitSchema(handle); err != nil {
		handle.Close()
		t.Fatalf("init schema: %v", err)
	}
	t.Cleanup(func() { handle.Close() })
	return handle
}

func mustAddGroup(t *testing.T, handle *sql.DB, slug string) {
	t.Helper()
	inserted, err := AddGroup(handle, slug, "name-"+slug, "desc")
	if err != nil || !inserted {
		t.Fatalf("add group %s: inserted=%v err=%v", slug, inserted, err)
	}
}

func mustInsertMemory(t *testing.T, handle *sql.DB, group, title string) string {
	t.Helper()
	id, err := InsertMemory(handle, group, title, "summary", "body", []string{"t"}, false, nil, nil)
	if err != nil {
		t.Fatalf("insert memory: %v", err)
	}
	return id
}

func TestGroupLifecycle(t *testing.T) {
	handle := newTestDB(t)

	inserted, err := AddGroup(handle, "proj", "项目", "desc")
	if err != nil || !inserted {
		t.Fatalf("first add: %v %v", inserted, err)
	}
	inserted, err = AddGroup(handle, "proj", "项目", "desc")
	if err != nil || inserted {
		t.Fatalf("second add should be ignored: %v %v", inserted, err)
	}

	mustInsertMemory(t, handle, "proj", "one")
	status, err := DeleteEmptyGroup(handle, "proj")
	if err != nil || status != "has_memories" {
		t.Fatalf("non-empty delete: %q %v", status, err)
	}

	status, err = DeleteEmptyGroup(handle, "missing")
	if err != nil || status != "not_found" {
		t.Fatalf("missing delete: %q %v", status, err)
	}

	mustAddGroup(t, handle, "empty")
	status, err = DeleteEmptyGroup(handle, "empty")
	if err != nil || status != "deleted" {
		t.Fatalf("empty delete: %q %v", status, err)
	}
}

func TestKeyLifecycle(t *testing.T) {
	handle := newTestDB(t)
	scopes := map[string]string{"proj": "rw"}
	if err := CreateKey(handle, "key12345", "name", "hashvalue", scopes); err != nil {
		t.Fatalf("create key: %v", err)
	}
	found, err := FindActiveKeyByHash(handle, "hashvalue")
	if err != nil || found == nil {
		t.Fatalf("find active key: %v %v", found, err)
	}
	if found["scopes"].(map[string]string)["proj"] != "rw" {
		t.Fatalf("scopes not decoded: %#v", found["scopes"])
	}

	status, err := UpdateKey(handle, "key12345", "renamed", map[string]string{"proj": "r", "study": "rw"})
	if err != nil || status != "updated" {
		t.Fatalf("update key: %q %v", status, err)
	}
	found, err = FindActiveKeyByHash(handle, "hashvalue")
	if err != nil || found == nil || found["name"] != "renamed" || found["scopes"].(map[string]string)["study"] != "rw" {
		t.Fatalf("updated active key mismatch: %#v err=%v", found, err)
	}
	fullKey, err := GetKey(handle, "key12345")
	if err != nil || fullKey == nil || fullKey["created_at"] == nil {
		t.Fatalf("GetKey must project full record including created_at: %#v err=%v", fullKey, err)
	}

	status, err = DeleteRevokedKey(handle, "key12345")
	if err != nil || status != "still_active" {
		t.Fatalf("delete active: %q %v", status, err)
	}
	status, err = RevokeKey(handle, "key12345")
	if err != nil || status != "revoked" {
		t.Fatalf("revoke: %q %v", status, err)
	}
	if status, err := UpdateKey(handle, "key12345", "after-revoke", map[string]string{"*": "r"}); err != nil || status != "already_revoked" {
		t.Fatalf("update revoked key: %q %v", status, err)
	}
	status, err = RevokeKey(handle, "key12345")
	if err != nil || status != "already_revoked" {
		t.Fatalf("re-revoke: %q %v", status, err)
	}
	if revoked, _ := FindActiveKeyByHash(handle, "hashvalue"); revoked != nil {
		t.Fatal("revoked key must not match")
	}
	status, err = DeleteRevokedKey(handle, "key12345")
	if err != nil || status != "deleted" {
		t.Fatalf("delete revoked: %q %v", status, err)
	}
}

func TestMemoryStateMachine(t *testing.T) {
	handle := newTestDB(t)
	mustAddGroup(t, handle, "proj")
	id := mustInsertMemory(t, handle, "proj", "title")

	updated, err := UpdateMemory(handle, id, map[string]any{"title": "renamed"})
	if err != nil || !updated {
		t.Fatalf("update: %v %v", updated, err)
	}
	deleted, err := SoftDeleteMemory(handle, id, "reason")
	if err != nil || !deleted {
		t.Fatalf("soft delete: %v %v", deleted, err)
	}
	// Update and soft delete are no-ops on an already deleted entry.
	if updated, _ := UpdateMemory(handle, id, map[string]any{"title": "again"}); updated {
		t.Fatal("update on deleted entry should be a no-op")
	}
	if deleted, _ := SoftDeleteMemory(handle, id, "again"); deleted {
		t.Fatal("second soft delete should be a no-op")
	}
	restored, err := RestoreMemory(handle, id, nil, db.UtcNow())
	if err != nil || !restored {
		t.Fatalf("restore: %v %v", restored, err)
	}
	if restored, _ := RestoreMemory(handle, id, nil, db.UtcNow()); restored {
		t.Fatal("restore on active entry should be a no-op")
	}
}

func TestListMemoriesForWebOrdering(t *testing.T) {
	handle := newTestDB(t)
	mustAddGroup(t, handle, "proj")
	a := mustInsertMemory(t, handle, "proj", "a")
	b := mustInsertMemory(t, handle, "proj", "b")
	future := "2099-01-01T00:00:00.000000+00:00"
	tempID, err := InsertMemory(handle, "proj", "temp", "s", "body", nil, false, &future, nil)
	if err != nil {
		t.Fatalf("insert temp: %v", err)
	}
	if _, err := UpdateMemory(handle, a, map[string]any{"pinned": 1}); err != nil {
		t.Fatalf("pin: %v", err)
	}
	rows, total, err := ListMemoriesForWeb(handle, map[string]string{"*": "rw"}, "active", "", "", 0, 20)
	if err != nil || total != 3 {
		t.Fatalf("list web: total=%d err=%v", total, err)
	}
	if rows[0]["id"] != a || rows[1]["id"] != tempID || rows[2]["id"] != b {
		t.Fatalf("unified order mismatch: got [%v, %v, %v], want [%s, %s, %s]",
			rows[0]["id"], rows[1]["id"], rows[2]["id"], a, tempID, b)
	}

	if _, err := SoftDeleteMemory(handle, b, "drop"); err != nil {
		t.Fatalf("delete b: %v", err)
	}
	deleted, total, err := ListMemoriesForWeb(handle, map[string]string{"*": "rw"}, "deleted", "", "", 0, 20)
	if err != nil || total != 1 || deleted[0]["id"] != b {
		t.Fatalf("deleted listing: total=%d rows=%v err=%v", total, deleted, err)
	}
}

func TestThreeStateMasking(t *testing.T) {
	handle := newTestDB(t)
	mustAddGroup(t, handle, "proj")
	mustAddGroup(t, handle, "other")
	allowed := mustInsertMemory(t, handle, "proj", "visible")
	hidden := mustInsertMemory(t, handle, "other", "secret")

	results, err := GetMemoriesBatchForAccess(handle, []string{allowed, hidden, "mem_nope"}, map[string]string{"proj": "r"}, false)
	if err != nil {
		t.Fatalf("batch: %v", err)
	}
	if results[0]["status"] != "authorized" {
		t.Fatalf("expected authorized, got %v", results[0])
	}
	if results[1]["status"] != "forbidden" {
		t.Fatalf("expected forbidden, got %v", results[1])
	}
	if len(results[1]) != 2 || results[1]["id"] != hidden {
		t.Fatalf("forbidden entry must expose only status and id, got %v", results[1])
	}
	if results[2]["status"] != "not_found" {
		t.Fatalf("expected not_found, got %v", results[2])
	}
}

func TestBodyProjection(t *testing.T) {
	handle := newTestDB(t)
	mustAddGroup(t, handle, "proj")
	mustInsertMemory(t, handle, "proj", "title")
	scopes := map[string]string{"proj": "r"}

	without, err := ListMemoriesForCatalogAndSearch(handle, scopes, "", "", true, false, false)
	if err != nil {
		t.Fatalf("search meta: %v", err)
	}
	if _, present := without[0]["body"]; present {
		t.Fatal("body must not be projected by default")
	}
	with, err := ListMemoriesForCatalogAndSearch(handle, scopes, "", "", true, false, true)
	if err != nil {
		t.Fatalf("search body: %v", err)
	}
	if _, present := with[0]["body"]; !present {
		t.Fatal("body must be projected when requested")
	}
}

func TestAdminVirtualKey(t *testing.T) {
	handle := newTestDB(t)
	t.Setenv("CAPSA_ADMIN_TOKEN", "  secret-token  ")
	key, err := GetKey(handle, "admin")
	if err != nil || key == nil {
		t.Fatalf("admin key: %v %v", key, err)
	}
	if key["scopes"].(map[string]string)["*"] != "rw" {
		t.Fatalf("admin grants wrong: %#v", key["scopes"])
	}
}

func TestListMemoriesForWebInWorkspaceNonWildcard(t *testing.T) {
	handle := newTestDB(t)
	ws2, err := CreateWorkspace(handle, "ws2", "", "memory", 3)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	ws2ID := ws2["id"].(string)

	mustAddGroup(t, handle, "proj")
	if status, err := AddGroupInWorkspace(handle, ws2ID, "other", "other", ""); err != nil || status != "inserted" {
		t.Fatalf("add group in ws2: %s %v", status, err)
	}

	mDefault := mustInsertMemory(t, handle, "proj", "in default")
	mWS2 := mustInsertMemory(t, handle, "other", "in ws2")

	// Non-wildcard scopes combined with explicit workspaceID must bind SQL parameters in order.
	rows, total, err := ListMemoriesForWebInWorkspace(handle, map[string]string{"proj": "rw", "other": "rw"}, ws2ID, "active", "", "", 0, 20)
	if err != nil {
		t.Fatalf("list in ws2: %v", err)
	}
	if total != 1 || len(rows) != 1 || rows[0]["id"] != mWS2 {
		t.Fatalf("ws2 rows = %v (total=%d), want [%s]", rows, total, mWS2)
	}

	// Default workspace filter with non-wildcard scope and group filter.
	rows, total, err = ListMemoriesForWebInWorkspace(handle, map[string]string{"proj": "rw", "other": "r"}, db.DefaultWorkspaceID, "active", "", "proj", 0, 20)
	if err != nil {
		t.Fatalf("list in default: %v", err)
	}
	if total != 1 || len(rows) != 1 || rows[0]["id"] != mDefault {
		t.Fatalf("default rows = %v (total=%d), want [%s]", rows, total, mDefault)
	}

	// Verify GetWorkspaceMode & ListActiveTitlesByGroup.
	mode, found, err := GetWorkspaceMode(handle, ws2ID)
	if err != nil || !found || mode != "memory" {
		t.Fatalf("GetWorkspaceMode = (%q, %v, %v)", mode, found, err)
	}
	if _, found, err := GetWorkspaceMode(handle, "ws_missing"); err != nil || found {
		t.Fatalf("missing workspace mode = (%v, %v)", found, err)
	}
	titles, err := ListActiveTitlesByGroup(handle, "proj")
	if err != nil || len(titles) != 1 || titles[0]["id"] != mDefault || titles[0]["title"] != "in default" {
		t.Fatalf("ListActiveTitlesByGroup = %v (%v)", titles, err)
	}
	if _, present := titles[0]["summary"]; present {
		t.Fatal("ListActiveTitlesByGroup must project only id and title")
	}
}

func TestArchiveExpiredRestorePurgeEmptyAndEditBody(t *testing.T) {
	handle := newTestDB(t)
	mustAddGroup(t, handle, "proj")
	mustAddGroup(t, handle, "ro")

	now := "2026-10-08T12:00:00.000000+00:00"
	past := "2026-10-01T00:00:00.000000+00:00"
	future := "2026-12-01T00:00:00.000000+00:00"

	// Fast-path: no expired entries.
	if archived, err := ArchiveExpiredMemories(handle, now); err != nil || archived != 0 {
		t.Fatalf("fast-path archive = (%d, %v), want 0", archived, err)
	}

	expID, err := InsertMemory(handle, "proj", "exp", "s", "alpha beta alpha", nil, false, &past, nil)
	if err != nil {
		t.Fatalf("insert expired: %v", err)
	}
	persID, err := InsertMemory(handle, "proj", "pers", "s", "body", nil, true, nil, nil)
	if err != nil {
		t.Fatalf("insert persistent: %v", err)
	}
	roID := mustInsertMemory(t, handle, "ro", "ro item")

	archived, err := ArchiveExpiredMemories(handle, now)
	if err != nil || archived != 1 {
		t.Fatalf("archive expired = (%d, %v), want 1", archived, err)
	}
	row, _ := GetMemoryForWeb(handle, expID)
	if row["deleted_at"] == nil || row["deleted_reason"] != "临时记忆到期自动归档" {
		t.Fatalf("archived row = %v", row)
	}

	// Restore expired without newExpiresAt clears expires_at.
	if ok, err := RestoreMemory(handle, expID, nil, now); err != nil || !ok {
		t.Fatalf("restore expired: %v %v", ok, err)
	}
	row, _ = GetMemoryForWeb(handle, expID)
	if row["deleted_at"] != nil || row["expires_at"] != nil {
		t.Fatalf("restored expired row must clear expires_at: %v", row)
	}

	// Restoring a soft-deleted persistent memory with newExpiresAt atomically clears pinned=0.
	_, _ = SoftDeleteMemory(handle, persID, "manual")
	if ok, err := RestoreMemory(handle, persID, &future, now); err != nil || !ok {
		t.Fatalf("restore persistent with expires_at: %v %v", ok, err)
	}
	persRow, _ := GetMemoryForWeb(handle, persID)
	if persRow["pinned"] != int64(0) || persRow["expires_at"] != future {
		t.Fatalf("restored persistent with expires_at must clear pinned=0: %v", persRow)
	}

	// EditMemoryBody checks.
	if count, status, err := EditMemoryBody(handle, expID, "alpha", "gamma", false, 64000); err != nil || status != "ambiguous" || count != 2 {
		t.Fatalf("ambiguous edit = (%d, %q, %v)", count, status, err)
	}
	if count, status, err := EditMemoryBody(handle, expID, "alpha", "gamma", true, 64000); err != nil || status != "edited" || count != 2 {
		t.Fatalf("replaceAll edit = (%d, %q, %v)", count, status, err)
	}
	if _, status, err := EditMemoryBody(handle, expID, "missing", "x", false, 64000); err != nil || status != "no_match" {
		t.Fatalf("no_match edit = (%q, %v)", status, err)
	}
	if _, status, err := EditMemoryBody(handle, expID, "gamma beta gamma", "   ", false, 64000); err != nil || status != "empty_body" {
		t.Fatalf("empty_body edit = (%q, %v)", status, err)
	}
	if _, status, err := EditMemoryBody(handle, expID, "beta", "0123456789", false, 10); err != nil || status != "body_too_long" {
		t.Fatalf("body_too_long edit = (%q, %v)", status, err)
	}

	// Purge & EmptyTrashMemories scope isolation.
	_, _ = SoftDeleteMemory(handle, expID, "drop")
	_, _ = SoftDeleteMemory(handle, roID, "drop")
	if deleted, err := EmptyTrashMemories(handle, []string{"proj"}, false, "", ""); err != nil || deleted != 1 {
		t.Fatalf("EmptyTrashMemories(proj) = (%d, %v), want 1", deleted, err)
	}
	if roRow, _ := GetMemoryForWeb(handle, roID); roRow == nil {
		t.Fatal("EmptyTrashMemories must never delete non-writable group trash")
	}
	if ok, err := PurgeMemory(handle, roID); err != nil || !ok {
		t.Fatalf("PurgeMemory(roID) = (%v, %v)", ok, err)
	}
	if roRow, _ := GetMemoryForWeb(handle, roID); roRow != nil {
		t.Fatal("PurgeMemory must physically delete row")
	}
}
