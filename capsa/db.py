"""SQLite storage base: path resolution, connection helper, schema and health check."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DB_PATH = "/data/capsa.db"

SCHEMA = """
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
"""


def db_path() -> str:
    """Resolve the database path at call time so tests can override CAPSA_DB_PATH."""
    return os.environ.get("CAPSA_DB_PATH", DEFAULT_DB_PATH)


def connect() -> sqlite3.Connection:
    path = Path(db_path())
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def check_db_health() -> bool:
    try:
        conn = connect()
        try:
            conn.execute("SELECT 1 FROM groups LIMIT 1").fetchone()
        finally:
            conn.close()
    except (sqlite3.Error, OSError):
        # Unwritable parent directories fail as OSError before sqlite3 is reached.
        return False
    return True


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()
