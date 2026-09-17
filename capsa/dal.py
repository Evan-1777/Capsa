"""Data access layer — the only module that issues SQL.

Every write function commits before returning: sqlite3 opens an implicit
transaction and rolls it back on close unless it is committed.
"""

from __future__ import annotations

import json
import sqlite3

from capsa.db import utcnow
from capsa.ids import new_memory_id
from capsa.permissions import ADMIN_GRANTS, ADMIN_KEY_ID, admin_token, permission_for

_MEMORY_READ_FIELDS = (
    "id, group_slug, title, summary, body, tags, review_at, pinned, created_at, updated_at"
)
_MEMORY_SEARCH_FIELDS = (
    "id, group_slug, title, summary, tags, review_at, pinned, updated_at"
)
# 正文投影只有 MCP 兜底检索显式开启时才使用，默认不查正文字段。
_MEMORY_SEARCH_WITH_BODY_FIELDS = f"{_MEMORY_SEARCH_FIELDS}, body"

_MEMORY_UPDATE_FIELDS = ("title", "summary", "body", "tags", "review_at", "pinned")

# Web 列表与详情的字段契约：列表始终带回收站字段，详情另带正文。
WEB_LIST_FIELDS = (
    "id", "group_slug", "title", "summary", "tags", "review_at", "pinned",
    "updated_at", "deleted_at", "deleted_reason",
)
WEB_ITEM_FIELDS = ("id", "group_slug", "title", "summary", "body", "tags", "review_at",
                   "pinned", "created_at", "updated_at", "deleted_at", "deleted_reason")

_WEB_LIST_COLUMNS = ", ".join(WEB_LIST_FIELDS)
_WEB_ITEM_COLUMNS = ", ".join(WEB_ITEM_FIELDS)


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
        elif permission_for(scopes, row["group_slug"]):
            results.append({"status": "authorized", **dict(row)})
        else:
            results.append({"status": "forbidden", "id": memory_id})
    return results


def list_active_memories_for_search(
    conn: sqlite3.Connection,
    scopes: dict[str, str],
    group: str | None = None,
    include_body: bool = False,
) -> list[dict]:
    """Active entries inside the authorized groups.

    正文按需投影：include_body 为真时才把 body 列带进结果，默认查询不读正文列。
    通配 rw 覆盖全库，此时不生成分组占位符，只保留可选的精确分组过滤。
    """
    # 通配覆盖全库与读写级别无关：*:r 同样全库可见，权限由 permission_for 逐条决定。
    wildcard = "*" in scopes
    slugs = sorted(scopes)
    if not wildcard and not slugs:
        return []
    conditions, params = ["deleted_at IS NULL"], []
    if not wildcard:
        conditions.append(f"group_slug IN ({_placeholders(len(slugs))})")
        params.extend(slugs)
    if group:
        conditions.append("group_slug = ?")
        params.append(group)
    fields = _MEMORY_SEARCH_WITH_BODY_FIELDS if include_body else _MEMORY_SEARCH_FIELDS
    sql = f"SELECT {fields} FROM memories WHERE {' AND '.join(conditions)}"
    return [dict(row) for row in conn.execute(sql, params)]


def add_group(conn: sqlite3.Connection, slug: str, name: str, description: str) -> bool:
    """Insert a group; False 表示该 slug 已存在（唯一约束在 SQL 内原子裁决）。"""
    cursor = conn.execute(
        "INSERT OR IGNORE INTO groups (slug, name, description, created_at) VALUES (?, ?, ?, ?)",
        (slug, name, description, utcnow()),
    )
    conn.commit()
    return cursor.rowcount > 0


def update_group(conn: sqlite3.Connection, slug: str, name: str, description: str) -> bool:
    """Rename a group in place; slug 一经创建即不可变，记忆的外键因此始终有效。"""
    cursor = conn.execute(
        "UPDATE groups SET name = ?, description = ? WHERE slug = ?", (name, description, slug)
    )
    conn.commit()
    return cursor.rowcount > 0


def delete_empty_group(conn: sqlite3.Connection, slug: str) -> str:
    """原子执行分类删除：以 IMMEDIATE 事务获取写锁，检查存在性与关联记忆（含回收站），无记忆则删除并提交。"""
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT 1 FROM groups WHERE slug = ?", (slug,)).fetchone()
        if row is None:
            conn.rollback()
            return "not_found"
        count_row = conn.execute(
            "SELECT COUNT(*) FROM memories WHERE group_slug = ?", (slug,)
        ).fetchone()
        if count_row and count_row[0] > 0:
            conn.rollback()
            return "has_memories"
        conn.execute("DELETE FROM groups WHERE slug = ?", (slug,))
        conn.commit()
        return "deleted"
    except Exception:
        conn.rollback()
        raise


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
    # 通配覆盖全库与读写级别无关：*:r 同样全库可见，权限由 permission_for 逐条决定。
    wildcard = "*" in scopes
    slugs = sorted(scopes)
    if not wildcard and not slugs:
        return []
    where, params = "", []
    if not wildcard:
        where = f"WHERE g.slug IN ({_placeholders(len(slugs))})"
        params = slugs
    rows = conn.execute(
        f"""
        SELECT g.slug, g.name, g.description,
               (SELECT COUNT(*) FROM memories m
                 WHERE m.group_slug = g.slug AND m.deleted_at IS NULL) AS count
        FROM groups g
        {where}
        ORDER BY g.slug
        """,
        params,
    )
    return [
        {**dict(row), "permission": permission_for(scopes, row["slug"])} for row in rows
    ]


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


def revoke_key(conn: sqlite3.Connection, key_id: str) -> str:
    row = conn.execute("SELECT revoked_at FROM keys WHERE id = ?", (key_id,)).fetchone()
    if row is None:
        return "not_found"
    if row["revoked_at"] is not None:
        return "already_revoked"
    conn.execute("UPDATE keys SET revoked_at = ? WHERE id = ?", (utcnow(), key_id))
    conn.commit()
    return "revoked"


def delete_revoked_key(conn: sqlite3.Connection, key_id: str) -> str:
    row = conn.execute("SELECT revoked_at FROM keys WHERE id = ?", (key_id,)).fetchone()
    if row is None:
        return "not_found"
    if row["revoked_at"] is None:
        return "still_active"
    conn.execute("DELETE FROM keys WHERE id = ?", (key_id,))
    conn.commit()
    return "deleted"


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
    """Insert an entry; a generated id retries on a primary key clash, a supplied one does not."""
    stamp = utcnow()
    candidate = memory_id
    for _ in range(3):
        candidate = candidate or new_memory_id()
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
            if memory_id:
                raise DuplicateMemoryId(memory_id) from None
            candidate = None
            continue
        conn.commit()
        return candidate
    raise DuplicateMemoryId(candidate)


def update_memory(conn: sqlite3.Connection, memory_id: str, fields: dict) -> bool:
    """Update the given whitelisted columns only; an empty mapping is a no-op."""
    changes = {key: value for key, value in fields.items() if key in _MEMORY_UPDATE_FIELDS}
    if not changes:
        return False
    if "tags" in changes:
        changes["tags"] = json.dumps(changes["tags"] or [], ensure_ascii=False)
    assignments = ", ".join(f"{name} = ?" for name in changes)
    cursor = conn.execute(
        f"UPDATE memories SET {assignments}, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
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


def list_memories_for_web(
    conn: sqlite3.Connection,
    scopes: dict[str, str],
    status: str = "active",
    group: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> tuple[list[dict], int]:
    """Paged active / overdue / deleted listing inside the authorized groups.

    Keyword matching is deliberately absent: hits and ordering belong to
    retrieval.rank_memories, so the SQL here never filters on a query.
    """
    # 通配覆盖全库与读写级别无关：*:r 同样全库可见，权限由 permission_for 逐条决定。
    wildcard = "*" in scopes
    slugs = sorted(scopes)
    if not wildcard and not slugs:
        return [], 0
    if status == "active":
        condition, params = "deleted_at IS NULL", []
    elif status == "deleted":
        condition, params = "deleted_at IS NOT NULL", []
    else:
        condition = "deleted_at IS NULL AND review_at IS NOT NULL AND review_at < ?"
        params = [utcnow()]
    scoped = "" if wildcard else f"group_slug IN ({_placeholders(len(slugs))}) AND "
    if not wildcard:
        # 占位符顺序由 scoped 决定，分组 slug 必须排在状态条件之前。
        params = [*slugs, *params]
    where = f"{scoped}{condition}"
    if group:
        where += " AND group_slug = ?"
    total = conn.execute(
        f"SELECT COUNT(*) FROM memories WHERE {where}", [*params, *([group] if group else [])]
    ).fetchone()[0]
    rows = conn.execute(
        f"SELECT {_WEB_LIST_COLUMNS} FROM memories WHERE {where} "
        "ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT ? OFFSET ?",
        [*params, *([group] if group else []), limit, offset],
    )
    return [dict(row) for row in rows], total


def get_memory_for_web(conn: sqlite3.Connection, memory_id: str) -> dict | None:
    """Fetch one entry without filtering deleted_at, so the recycle bin can locate it."""
    row = conn.execute(
        f"SELECT {_WEB_ITEM_COLUMNS} FROM memories WHERE id = ?", (memory_id,)
    ).fetchone()
    return dict(row) if row else None


def get_key(conn: sqlite3.Connection, key_id: str) -> dict | None:
    """环境变量配置了管理级令牌时，虚拟管理员身份不落库即成立。"""
    if key_id == ADMIN_KEY_ID and admin_token():
        return {"id": ADMIN_KEY_ID, "name": "Admin", "scopes": ADMIN_GRANTS}
    row = conn.execute(
        "SELECT id, name, scopes FROM keys WHERE id = ?", (key_id,)
    ).fetchone()
    if row is None:
        return None
    return {"id": row["id"], "name": row["name"], "scopes": json.loads(row["scopes"])}
