// Package db is the SQLite storage base: path resolution, connection helper,
// schema bootstrap and health check. It holds no business logic.
package db

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver, no CGO
)

// DefaultDBPath mirrors the container volume mount.
const DefaultDBPath = "/data/capsa.db"

// Schema is the idempotent DDL for the three tables and their index. It is the
// single source of truth for storage structure.
const Schema = `
CREATE TABLE IF NOT EXISTS groups (
    slug TEXT PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_memories_group_order
ON memories(group_slug, pinned DESC, updated_at DESC);
`

// DBPath resolves the database path at call time so tests can override
// CAPSA_DB_PATH without touching import-time state.
func DBPath() string {
	if path := os.Getenv("CAPSA_DB_PATH"); path != "" {
		return path
	}
	return DefaultDBPath
}

// Connect opens a short-lived handle to the configured database. The WAL
// journal, foreign key enforcement and a busy timeout are applied through the
// DSN so every pooled connection inherits them.
func Connect() (*sql.DB, error) {
	path := DBPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	params := url.Values{}
	params.Add("_pragma", "journal_mode(WAL)")
	params.Add("_pragma", "foreign_keys(1)")
	params.Add("_pragma", "busy_timeout(5000)")
	dsn := "file:" + path + "?" + params.Encode()
	handle, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// A single request runs its statements sequentially; one pooled connection
	// removes intra-handle contention while the busy timeout absorbs the rare
	// cross-request overlap.
	handle.SetMaxOpenConns(1)
	return handle, nil
}

// InitSchema creates the tables and index. Running it repeatedly is safe.
func InitSchema(handle *sql.DB) error {
	if _, err := handle.Exec(Schema); err != nil {
		return err
	}
	return nil
}

// CheckDBHealth reports whether the database is reachable and initialized.
func CheckDBHealth() bool {
	handle, err := Connect()
	if err != nil {
		return false
	}
	defer handle.Close()
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
