package db

import (
	"path/filepath"
	"testing"
)

// legacySchema reproduces the pre-workspace storage layout: no workspaces table
// and a groups table without workspace_id.
const legacySchema = "CREATE TABLE groups (\n" +
	"    slug TEXT PRIMARY KEY,\n" +
	"    name TEXT NOT NULL,\n" +
	"    description TEXT NOT NULL,\n" +
	"    created_at TEXT NOT NULL\n" +
	");\n" +
	"CREATE TABLE keys (\n" +
	"    id TEXT PRIMARY KEY,\n" +
	"    name TEXT NOT NULL,\n" +
	"    token_hash TEXT UNIQUE NOT NULL,\n" +
	"    scopes TEXT NOT NULL,\n" +
	"    created_at TEXT NOT NULL,\n" +
	"    last_used_at TEXT,\n" +
	"    revoked_at TEXT\n" +
	");\n" +
	"CREATE TABLE memories (\n" +
	"    id TEXT PRIMARY KEY,\n" +
	"    group_slug TEXT NOT NULL REFERENCES groups(slug),\n" +
	"    title TEXT NOT NULL CHECK(length(title) <= 60),\n" +
	"    summary TEXT NOT NULL CHECK(length(summary) <= 200),\n" +
	"    body TEXT NOT NULL CHECK(length(body) <= 64000),\n" +
	"    tags TEXT NOT NULL DEFAULT '[]',\n" +
	"    review_at TEXT,\n" +
	"    pinned INTEGER NOT NULL DEFAULT 0,\n" +
	"    created_at TEXT NOT NULL,\n" +
	"    updated_at TEXT NOT NULL,\n" +
	"    deleted_at TEXT,\n" +
	"    deleted_reason TEXT\n" +
	");\n" +
	"CREATE INDEX idx_memories_group_order ON memories(group_slug, pinned DESC, updated_at DESC);"

func TestMigrateIfInitializedSkipsUninitializedDatabase(t *testing.T) {
	t.Setenv("CAPSA_DB_PATH", filepath.Join(t.TempDir(), "capsa.db"))
	handle, err := Connect()
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer handle.Close()
	if err := MigrateIfInitialized(handle); err != nil {
		t.Fatalf("uninitialized migration must be a no-op: %v", err)
	}
	var name string
	err = handle.QueryRow("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'").Scan(&name)
	if err == nil {
		t.Fatal("an uninitialized database must not be upgraded implicitly")
	}
	if CheckDBHealth() {
		t.Fatal("health check must stay false before capsa init")
	}
}

func TestMigrateIfInitializedUpgradesLegacyDatabase(t *testing.T) {
	t.Setenv("CAPSA_DB_PATH", filepath.Join(t.TempDir(), "capsa.db"))
	handle, err := Connect()
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer handle.Close()
	if _, err := handle.Exec(legacySchema); err != nil {
		t.Fatalf("legacy schema: %v", err)
	}
	stamp := "2026-01-01T00:00:00.000000+00:00"
	if _, err := handle.Exec("INSERT INTO groups (slug, name, description, created_at) VALUES ('proj', '项目', '旧库分组', ?)", stamp); err != nil {
		t.Fatalf("legacy group: %v", err)
	}
	if _, err := handle.Exec("INSERT INTO memories (id, group_slug, title, summary, body, tags, created_at, updated_at) VALUES ('mem_legacy', 'proj', 't', 's', 'b', '[]', ?, ?)", stamp, stamp); err != nil {
		t.Fatalf("legacy memory: %v", err)
	}
	if !CheckDBHealth() {
		t.Fatal("a legacy database with a groups table is healthy before migration")
	}

	if err := MigrateIfInitialized(handle); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var workspaceID string
	if err := handle.QueryRow("SELECT workspace_id FROM groups WHERE slug = 'proj'").Scan(&workspaceID); err != nil {
		t.Fatalf("read migrated column: %v", err)
	}
	if workspaceID != DefaultWorkspaceID {
		t.Fatalf("legacy group workspace = %q, want %q", workspaceID, DefaultWorkspaceID)
	}
	var mode string
	var shallowMonths int
	if err := handle.QueryRow("SELECT mode, shallow_months FROM workspaces WHERE id = ?", DefaultWorkspaceID).Scan(&mode, &shallowMonths); err != nil {
		t.Fatalf("default workspace missing: %v", err)
	}
	if mode != "memory" || shallowMonths != DefaultShallowMonths {
		t.Fatalf("default workspace = (%q, %d), want (memory, %d)", mode, shallowMonths, DefaultShallowMonths)
	}
	var bodies int
	if err := handle.QueryRow("SELECT COUNT(*) FROM memories WHERE id = 'mem_legacy' AND expires_at IS NULL AND pinned = 0").Scan(&bodies); err != nil || bodies != 1 {
		t.Fatalf("legacy memory lost or unexpected defaults: count=%d err=%v", bodies, err)
	}
	// Verify doc_categories.sort_order column exists after migration.
	if _, err := handle.Exec("INSERT INTO doc_categories (id, workspace_id, name, description, access_id, created_at, updated_at) VALUES ('cat_1', ?, 'c', '', 'acc_1', ?, ?)", DefaultWorkspaceID, stamp, stamp); err != nil {
		t.Fatalf("insert doc_category after migration: %v", err)
	}
	var sortOrder int
	if err := handle.QueryRow("SELECT sort_order FROM doc_categories WHERE id = 'cat_1'").Scan(&sortOrder); err != nil || sortOrder != 0 {
		t.Fatalf("doc_categories.sort_order = %d err=%v, want 0", sortOrder, err)
	}

	// A second startup must be a harmless no-op.
	if err := MigrateIfInitialized(handle); err != nil {
		t.Fatalf("second migrate must be idempotent: %v", err)
	}
}

func TestInitSchemaSeedsDefaultWorkspace(t *testing.T) {
	t.Setenv("CAPSA_DB_PATH", filepath.Join(t.TempDir(), "capsa.db"))
	handle, err := Connect()
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer handle.Close()
	if err := InitSchema(handle); err != nil {
		t.Fatalf("init: %v", err)
	}
	if err := InitSchema(handle); err != nil {
		t.Fatalf("second init: %v", err)
	}
	var mode string
	if err := handle.QueryRow("SELECT mode FROM workspaces WHERE id = ?", DefaultWorkspaceID).Scan(&mode); err != nil {
		t.Fatalf("default workspace: %v", err)
	}
	if mode != "memory" {
		t.Fatalf("default workspace mode = %q", mode)
	}
	var total int
	if err := handle.QueryRow("SELECT COUNT(*) FROM workspaces").Scan(&total); err != nil || total != 1 {
		t.Fatalf("workspace count = %d err=%v, want 1", total, err)
	}
}
