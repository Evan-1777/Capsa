// Package db is the SQLite storage base: path resolution, connection helper,
// schema bootstrap and health check. It holds no business logic.
package db

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver, no CGO
)

// DefaultDBPath mirrors the container volume mount.
const DefaultDBPath = "/data/capsa.db"

// Default memory workspace, created by InitSchema so aggregate SQL stays
// non-null and existing groups have a stable owner.
const (
	DefaultWorkspaceID   = "default"
	DefaultWorkspaceName = "默认记忆工作区"
	DefaultWorkspaceDesc = "系统默认记忆工作区"
)

// Schema is the idempotent DDL for every table. It is the single source of
// truth for storage structure. Indexes live in IndexSchema because adding an
// index on a column that a legacy database still lacks must wait for the
// column migration.
const Schema = `
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL CHECK(mode IN ('memory', 'docs')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
    slug TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    scopes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    group_slug TEXT NOT NULL REFERENCES groups(slug),
    title TEXT NOT NULL CHECK(length(title) <= 60),
    summary TEXT NOT NULL CHECK(length(summary) <= 200),
    body TEXT NOT NULL CHECK(length(body) <= 64000),
    tags TEXT NOT NULL DEFAULT '[]',
    review_at TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    deleted_reason TEXT
);

CREATE TABLE IF NOT EXISTS doc_categories (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    access_id TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    scope TEXT NOT NULL CHECK(scope IN ('public', 'category')),
    category_id TEXT REFERENCES doc_categories(id),
    path TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK((scope = 'public' AND category_id IS NULL) OR (scope = 'category' AND category_id IS NOT NULL))
);
`

// IndexSchema carries every index. The two partial unique indexes on documents
// exist because a plain composite UNIQUE treats NULL category_id values as
// distinct and would let duplicate public documents through.
const IndexSchema = `
CREATE INDEX IF NOT EXISTS idx_groups_workspace ON groups(workspace_id);

CREATE INDEX IF NOT EXISTS idx_memories_group_order
ON memories(group_slug, pinned DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_active_global
ON memories(pinned DESC, updated_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memories_overdue
ON memories(review_at) WHERE deleted_at IS NULL AND review_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memories_deleted
ON memories(deleted_at DESC, id DESC) WHERE deleted_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_categories_ws_name
ON doc_categories(workspace_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_public_path
ON documents(workspace_id, path) WHERE category_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_category_path
ON documents(workspace_id, category_id, path) WHERE category_id IS NOT NULL;
`

// DBPath resolves the database path at call time so tests can override
// CAPSA_DB_PATH without touching import-time state.
func DBPath() string {
	if path := os.Getenv("CAPSA_DB_PATH"); path != "" {
		return path
	}
	return DefaultDBPath
}

var (
	sharedMu     sync.Mutex
	sharedHandle *sql.DB
	sharedPath   string
)

func openHandle(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	params := url.Values{}
	params.Add("_pragma", "journal_mode(WAL)")
	params.Add("_pragma", "foreign_keys(1)")
	params.Add("_pragma", "busy_timeout(5000)")
	// WAL + synchronous(NORMAL) trades OS power-loss durability of the last commit
	// for substantially lower commit latency on a personal VPS.
	params.Add("_pragma", "synchronous(NORMAL)")
	params.Add("_pragma", "temp_store(MEMORY)")
	params.Add("_pragma", "cache_size(-2000)")
	dsn := "file:" + path + "?" + params.Encode()
	handle, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// Intra-process queries serialize through one pooled connection while
	// busy_timeout(5000) absorbs cross-process backup contention.
	handle.SetMaxOpenConns(1)
	return handle, nil
}

// Connect opens a standalone handle to the configured database for offline CLI
// tasks or isolated schema callers. Callers own closing the returned handle.
func Connect() (*sql.DB, error) {
	return openHandle(DBPath())
}

// Shared returns the process-wide shared database handle for the active DBPath.
// When DBPath changes (e.g. via test t.Setenv), the previous handle is closed
// and replaced automatically so tests stay isolated without per-request opens.
func Shared() (*sql.DB, error) {
	sharedMu.Lock()
	defer sharedMu.Unlock()
	current := DBPath()
	if sharedHandle != nil && sharedPath == current {
		return sharedHandle, nil
	}
	if sharedHandle != nil {
		_ = sharedHandle.Close()
		sharedHandle = nil
		sharedPath = ""
	}
	handle, err := openHandle(current)
	if err != nil {
		return nil, err
	}
	sharedHandle = handle
	sharedPath = current
	return sharedHandle, nil
}

// CloseShared closes and clears the cached process-wide shared handle.
func CloseShared() error {
	sharedMu.Lock()
	defer sharedMu.Unlock()
	if sharedHandle == nil {
		return nil
	}
	err := sharedHandle.Close()
	sharedHandle = nil
	sharedPath = ""
	return err
}

// InitSchema creates the tables, upgrades a legacy groups table with the
// workspace column and seeds the default memory workspace. Running it
// repeatedly is safe.
func InitSchema(handle *sql.DB) error {
	if _, err := handle.Exec(Schema); err != nil {
		return err
	}
	if err := ensureGroupWorkspaceColumn(handle); err != nil {
		return err
	}
	if _, err := handle.Exec(IndexSchema); err != nil {
		return err
	}
	return seedDefaultWorkspace(handle)
}

// ensureGroupWorkspaceColumn adds groups.workspace_id to databases created
// before the workspace model. CREATE TABLE IF NOT EXISTS is a no-op there, so
// the column only appears through this migration. The added column carries no
// REFERENCES clause: SQLite rejects a non-NULL default on a column that
// declares one while foreign key enforcement is on.
func ensureGroupWorkspaceColumn(handle *sql.DB) error {
	rows, err := handle.Query("PRAGMA table_info(groups)")
	if err != nil {
		return err
	}
	defer rows.Close()
	present := false
	for rows.Next() {
		var (
			cid        int
			name       string
			columnType string
			notNull    int
			defaultVal sql.NullString
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultVal, &primaryKey); err != nil {
			return err
		}
		if name == "workspace_id" {
			present = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if present {
		return nil
	}
	_, err = handle.Exec("ALTER TABLE groups ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default'")
	return err
}

func seedDefaultWorkspace(handle *sql.DB) error {
	stamp := UtcNow()
	_, err := handle.Exec(
		"INSERT OR IGNORE INTO workspaces (id, name, description, mode, created_at, updated_at) VALUES (?, ?, ?, 'memory', ?, ?)",
		DefaultWorkspaceID, DefaultWorkspaceName, DefaultWorkspaceDesc, stamp, stamp)
	return err
}

// MigrateIfInitialized upgrades an already-initialized database in place. A
// database without a groups table has never been initialized and is left
// untouched, so CheckDBHealth keeps reporting false until capsa init runs.
func MigrateIfInitialized(handle *sql.DB) error {
	var name string
	err := handle.QueryRow(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'groups'").Scan(&name)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	return InitSchema(handle)
}

// CheckDBHealth reports whether the database is reachable and initialized.
func CheckDBHealth() bool {
	handle, err := Shared()
	if err != nil {
		return false
	}
	var one int
	err = handle.QueryRow("SELECT 1 FROM groups LIMIT 1").Scan(&one)
	// An empty groups table is healthy; only a missing table or I/O failure is not.
	return err == nil || err == sql.ErrNoRows
}

// UtcNow renders the current UTC time in a fixed-width layout carrying exactly
// six fractional digits and a "+00:00" offset. The fixed width keeps SQL string
// ordering (review_at < ?, ORDER BY updated_at DESC) equivalent to time order.
func UtcNow() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000000-07:00")
}

// naiveLayouts cover ISO 8601 inputs that omit a timezone offset; such values
// are read as UTC, matching the storage convention.
var naiveLayouts = []string{
	"2006-01-02T15:04:05.999999999",
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05.999999999",
	"2006-01-02 15:04:05",
	"2006-01-02",
}

// ParseTimestamp reads an ISO 8601 timestamp into a time.Time. A value without
// an offset is read as UTC. It returns an error for unparseable input.
func ParseTimestamp(value string) (time.Time, error) {
	if moment, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return moment.UTC(), nil
	}
	for _, layout := range naiveLayouts {
		if moment, err := time.Parse(layout, value); err == nil {
			return moment.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("parse timestamp %q", value)
}
