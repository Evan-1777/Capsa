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
	id, err := InsertMemory(handle, group, title, "summary", "body", []string{"t"}, nil, nil)
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

	status, err := DeleteRevokedKey(handle, "key12345")
	if err != nil || status != "still_active" {
		t.Fatalf("delete active: %q %v", status, err)
	}
	status, err = RevokeKey(handle, "key12345")
	if err != nil || status != "revoked" {
		t.Fatalf("revoke: %q %v", status, err)
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
	restored, err := RestoreMemory(handle, id)
	if err != nil || !restored {
		t.Fatalf("restore: %v %v", restored, err)
	}
	if restored, _ := RestoreMemory(handle, id); restored {
		t.Fatal("restore on active entry should be a no-op")
	}
}

func TestListMemoriesForWebOrdering(t *testing.T) {
	handle := newTestDB(t)
	mustAddGroup(t, handle, "proj")
	pinned := true
	a := mustInsertMemory(t, handle, "proj", "a")
	b := mustInsertMemory(t, handle, "proj", "b")
	if _, err := UpdateMemory(handle, a, map[string]any{"pinned": pinned}); err != nil {
		t.Fatalf("pin: %v", err)
	}
	rows, total, err := ListMemoriesForWeb(handle, map[string]string{"*": "rw"}, "active", "", 0, 20)
	if err != nil || total != 2 {
		t.Fatalf("list web: total=%d err=%v", total, err)
	}
	if rows[0]["id"] != a {
		t.Fatalf("pinned entry must sort first, got %v", rows[0]["id"])
	}

	if _, err := SoftDeleteMemory(handle, b, "drop"); err != nil {
		t.Fatalf("delete b: %v", err)
	}
	deleted, total, err := ListMemoriesForWeb(handle, map[string]string{"*": "rw"}, "deleted", "", 0, 20)
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

	results, err := GetMemoriesBatchForAccess(handle, []string{allowed, hidden, "mem_nope"}, map[string]string{"proj": "r"})
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

	without, err := ListActiveMemoriesForSearch(handle, scopes, "", false)
	if err != nil {
		t.Fatalf("search meta: %v", err)
	}
	if _, present := without[0]["body"]; present {
		t.Fatal("body must not be projected by default")
	}
	with, err := ListActiveMemoriesForSearch(handle, scopes, "", true)
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
