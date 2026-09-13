"""Data access layer — the only module that issues SQL.

Every write function commits before returning: sqlite3 opens an implicit
transaction and rolls it back on close unless it is committed.
"""

from __future__ import annotations

import json
import sqlite3

from capsa.db import utcnow
from capsa.ids import new_memory_id

_MEMORY_READ_FIELDS = (
    "id, group_slug, title, summary, body, tags, review_at, pinned, created_at, updated_at"
)
_MEMORY_SEARCH_FIELDS = (
    "id, group_slug, title, summary, tags, review_at, pinned, updated_at"
)

_MEMORY_UPDATE_FIELDS = ("title", "summary", "body", "tags", "review_at", "pinned")


class DuplicateMemoryId(Exception):
    """Raised when every generated memory id collided with an existing primary key."""


def _placeholders(count: int) -> str:
    return ",".join("?" * count)


def get_memories_batch_for_access(
    conn: sqlite3.Connection, ids: list[str], scopes: dict[str, str]
) -> list[dict]:
    """Three-state judgement per requested id, in the order the ids were given."""
    if not ids:
        return []
    rows = {
        row["id"]: row
        for row in conn.execute(
            f"SELECT {_MEMORY_READ_FIELDS} FROM memories "
            f"WHERE id IN ({_placeholders(len(ids))}) AND deleted_at IS NULL",
            ids,
        )
    }
    results = []
    for memory_id in ids:
        row = rows.get(memory_id)
        if row is None:
            results.append({"status": "not_found", "id": memory_id})
        elif row["group_slug"] in scopes:
            results.append({"status": "authorized", **dict(row)})
        else:
            results.append({"status": "forbidden", "id": memory_id})
    return results


def list_active_memories_for_search(
    conn: sqlite3.Connection, scopes: dict[str, str], group: str | None = None
) -> list[dict]:
    """Active entries inside the authorized groups; never returns body."""
    slugs = sorted(scopes)
    if not slugs:
        return []
    sql = (
        f"SELECT {_MEMORY_SEARCH_FIELDS} FROM memories "
        f"WHERE group_slug IN ({_placeholders(len(slugs))}) AND deleted_at IS NULL"
    )
    params: list[str] = list(slugs)
    if group:
        sql += " AND group_slug = ?"
        params.append(group)
    return [dict(row) for row in conn.execute(sql, params)]


def add_group(conn: sqlite3.Connection, slug: str, name: str, description: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO groups (slug, name, description, created_at) VALUES (?, ?, ?, ?)",
        (slug, name, description, utcnow()),
    )
    conn.commit()


def get_group(conn: sqlite3.Connection, slug: str) -> dict | None:
    row = conn.execute(
        "SELECT slug, name, description, created_at FROM groups WHERE slug = ?", (slug,)
    ).fetchone()
    return dict(row) if row else None


def list_groups(conn: sqlite3.Connection) -> list[dict]:
    return [
        dict(row)
        for row in conn.execute(
            "SELECT slug, name, description FROM groups ORDER BY slug"
        )
    ]


def list_groups_with_counts(
    conn: sqlite3.Connection, scopes: dict[str, str]
) -> list[dict]:
    slugs = sorted(scopes)
    if not slugs:
        return []
    rows = conn.execute(
        f"""
        SELECT g.slug, g.name, g.description,
               (SELECT COUNT(*) FROM memories m
                 WHERE m.group_slug = g.slug AND m.deleted_at IS NULL) AS count
        FROM groups g
        WHERE g.slug IN ({_placeholders(len(slugs))})
        ORDER BY g.slug
        """,
        slugs,
    )
    return [{**dict(row), "permission": scopes[row["slug"]]} for row in rows]


def create_key(
    conn: sqlite3.Connection,
    key_id: str,
    name: str,
    token_hash: str,
    scopes: dict[str, str],
) -> None:
    conn.execute(
        "INSERT INTO keys (id, name, token_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?)",
        (key_id, name, token_hash, json.dumps(scopes, ensure_ascii=False), utcnow()),
    )
    conn.commit()


def find_active_key_by_hash(conn: sqlite3.Connection, token_hash: str) -> dict | None:
    row = conn.execute(
        "SELECT id, name, scopes FROM keys WHERE token_hash = ? AND revoked_at IS NULL",
        (token_hash,),
    ).fetchone()
    if row is None:
        return None
    return {"id": row["id"], "name": row["name"], "scopes": json.loads(row["scopes"])}


def revoke_key(conn: sqlite3.Connection, key_id: str) -> bool:
    cursor = conn.execute(
        "UPDATE keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        (utcnow(), key_id),
    )
    conn.commit()
    return cursor.rowcount > 0


def list_keys(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT id, name, scopes, created_at, last_used_at, revoked_at "
        "FROM keys ORDER BY created_at, id"
    )
    return [{**dict(row), "scopes": json.loads(row["scopes"])} for row in rows]


def touch_last_used_at(conn: sqlite3.Connection, key_id: str) -> None:
    conn.execute("UPDATE keys SET last_used_at = ? WHERE id = ?", (utcnow(), key_id))
    conn.commit()


def insert_memory(
    conn: sqlite3.Connection,
    *,
    group_slug: str,
    title: str,
    summary: str,
    body: str,
    tags: list[str],
    review_at: str | None,
    memory_id: str | None = None,
) -> str:
    """Insert an entry, regenerating the id up to three times on a primary key clash."""
    stamp = utcnow()
    for _ in range(3):
        candidate = memory_id or new_memory_id()
        try:
            conn.execute(
                "INSERT INTO memories (id, group_slug, title, summary, body, tags, review_at,"
                " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    candidate,
                    group_slug,
                    title,
                    summary,
                    body,
                    json.dumps(tags, ensure_ascii=False),
                    review_at,
                    stamp,
                    stamp,
                ),
            )
        except sqlite3.IntegrityError as error:
            if "UNIQUE constraint failed" not in str(error):
                raise
            memory_id = None
            continue
        conn.commit()
        return candidate
    raise DuplicateMemoryId(memory_id)


def update_memory(conn: sqlite3.Connection, memory_id: str, fields: dict) -> bool:
    """Update the given whitelisted columns only; an empty mapping is a no-op."""
    changes = {key: value for key, value in fields.items() if key in _MEMORY_UPDATE_FIELDS}
    if not changes:
        return False
    if "tags" in changes:
        changes["tags"] = json.dumps(changes["tags"] or [], ensure_ascii=False)
    assignments = ", ".join(f"{name} = ?" for name in changes)
    cursor = conn.execute(
        f"UPDATE memories SET {assignments}, updated_at = ? WHERE id = ?",
        [*changes.values(), utcnow(), memory_id],
    )
    conn.commit()
    return cursor.rowcount > 0


def soft_delete_memory(conn: sqlite3.Connection, memory_id: str, reason: str) -> bool:
    cursor = conn.execute(
        "UPDATE memories SET deleted_at = ?, deleted_reason = ? "
        "WHERE id = ? AND deleted_at IS NULL",
        (utcnow(), reason, memory_id),
    )
    conn.commit()
    return cursor.rowcount > 0


def restore_memory(conn: sqlite3.Connection, memory_id: str) -> bool:
    cursor = conn.execute(
        "UPDATE memories SET deleted_at = NULL, deleted_reason = NULL "
        "WHERE id = ? AND deleted_at IS NOT NULL",
        (memory_id,),
    )
    conn.commit()
    return cursor.rowcount > 0


def list_deleted_memories(
    conn: sqlite3.Connection, group_slug: str | None = None
) -> list[dict]:
    sql = (
        "SELECT id, group_slug, title, deleted_at, deleted_reason FROM memories "
        "WHERE deleted_at IS NOT NULL"
    )
    params: list[str] = []
    if group_slug:
        sql += " AND group_slug = ?"
        params.append(group_slug)
    return [dict(row) for row in conn.execute(sql + " ORDER BY deleted_at DESC, id DESC", params)]
