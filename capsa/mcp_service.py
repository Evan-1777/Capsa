"""FastMCP instance and the read-write tool set."""

from __future__ import annotations

import sqlite3

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.types import ToolAnnotations

from capsa import dal, db, formatters, retrieval
from capsa.auth import CapsaTokenVerifier

SEARCH_LIMIT = 20
PEEK_LIMIT = 10
READ_LIMIT = 5

# 与 capsa/db.py 的 CHECK 约束同源，超限由工具层在落库前拒绝。
TITLE_MAX = 60
SUMMARY_MAX = 200
BODY_MAX = 64000

READ_ONLY = ToolAnnotations(readOnlyHint=True)
WRITE_CREATE = ToolAnnotations(destructiveHint=False)
WRITE_UPDATE = ToolAnnotations(idempotentHint=True)
WRITE_DELETE = ToolAnnotations(destructiveHint=True)
USAGE = (
    "读取协议：先用 memory_search 取标题层，再用 memory_peek 看摘要，"
    "最后才用 memory_read 读正文；不要一次性读取正文。"
)

mcp = FastMCP("capsa", auth=CapsaTokenVerifier())


def _grants() -> dict[str, str]:
    """Authorized group to permission map, taken from the current request token."""
    token = get_access_token()
    if token is None or not token.claims:
        return {}
    return token.claims.get("grants", {})


def _reject_over_limit(ids: list[str], limit: int) -> None:
    if len(ids) > limit:
        raise ToolError(f"ids 上限为 {limit}，本次传入 {len(ids)} 条")


def _require_text(value: str | None, limit: int, label: str) -> str:
    """Shared non-empty and length check; returns the value for the caller to store."""
    if value is None or not value.strip():
        raise ToolError(f"{label}不能为空")
    if len(value) > limit:
        raise ToolError(f"{label}超长 (当前 {len(value)} 字符，上限 {limit} 字符，拒绝写入)")
    return value


def _locate_writable(conn, memory_id: str) -> dict:
    """Resolve the target entry and require write permission on its group.

    A forbidden entry and a missing entry share one message: the difference
    would let an unauthorized caller probe whether a group exists.
    """
    item = dal.get_memories_batch_for_access(conn, [memory_id], _grants())[0]
    if item["status"] != "authorized":
        raise ToolError(f"记忆 {memory_id} 不存在或无权访问")
    permission = _grants().get(item["group_slug"])
    if permission != "rw":
        raise ToolError(
            f"Key {_key_id()} 对分组 {item['group_slug']} 只有只读权限，拒绝修改"
        )
    return item


def _key_id() -> str:
    token = get_access_token()
    return (token.claims or {}).get("key_id", "") if token else ""


def _parse_review_at(value: str) -> str:
    try:
        return retrieval.normalize_review_at(value)
    except ValueError:
        raise ToolError(f"review_at 不是合法的 ISO 8601 时间：{value}") from None


@mcp.tool(annotations=READ_ONLY, description=f"列出当前 Key 可访问的分组、条目数与读写权限。{USAGE}")
def memory_groups() -> str:
    scopes = _grants()
    conn = db.connect()
    try:
        return formatters.format_groups(dal.list_groups_with_counts(conn, scopes))
    finally:
        conn.close()


@mcp.tool(
    annotations=READ_ONLY,
    description=f"L1 标题层检索。query 省略时按置顶与更新时间倒序浏览；limit 上限 {SEARCH_LIMIT}。{USAGE}",
)
def memory_search(query: str | None = None, group: str | None = None, limit: int = 10) -> str:
    if not 1 <= limit <= SEARCH_LIMIT:
        raise ToolError(f"limit 取值范围为 1~{SEARCH_LIMIT}，本次传入 {limit}")
    scopes = _grants()
    conn = db.connect()
    try:
        memories = dal.list_active_memories_for_search(conn, scopes, group)
    finally:
        conn.close()
    ranked = retrieval.rank_memories(memories, query or "")[:limit]
    return formatters.format_search(query or "", ranked, scopes)


@mcp.tool(
    annotations=READ_ONLY,
    description=f"L2 摘要层。ids 上限 {PEEK_LIMIT}。{USAGE}",
)
def memory_peek(ids: list[str]) -> str:
    _reject_over_limit(ids, PEEK_LIMIT)
    conn = db.connect()
    try:
        items = dal.get_memories_batch_for_access(conn, ids, _grants())
    finally:
        conn.close()
    return formatters.format_peek(items)


@mcp.tool(
    annotations=READ_ONLY,
    description=(
        f"L3 正文层。ids 上限 {READ_LIMIT}，offset 为字符偏移（负数按 0 处理，"
        f"超出正文长度时返回结尾提示），单条正文最多返回 {formatters.MAX_BODY_CHARS} 字符。{USAGE}"
    ),
)
def memory_read(ids: list[str], offset: int = 0) -> str:
    _reject_over_limit(ids, READ_LIMIT)
    conn = db.connect()
    try:
        items = dal.get_memories_batch_for_access(conn, ids, _grants())
    finally:
        conn.close()
    return formatters.format_read(items, offset)


@mcp.tool(
    annotations=WRITE_CREATE,
    description=(
        f"新建记忆，需要目标分组的 rw 权限。title ≤ {TITLE_MAX} 字符，"
        f"summary ≤ {SUMMARY_MAX} 字符，body ≤ {BODY_MAX} 字符；超限拒绝写入且不截断。"
        "同分组存在相似标题时照常创建，并在结果中提示相似条目。"
    ),
)
def memory_save(
    group: str,
    title: str,
    summary: str,
    body: str,
    tags: list[str] | None = None,
    review_at: str | None = None,
) -> str:
    grants = _grants()
    if grants.get(group) != "rw":
        raise ToolError(f"Key {_key_id()} 对分组 {group} 没有写权限，拒绝写入")
    _require_text(title, TITLE_MAX, "标题")
    _require_text(summary, SUMMARY_MAX, "摘要")
    _require_text(body, BODY_MAX, "正文")
    stamp = _parse_review_at(review_at) if review_at else None
    conn = db.connect()
    try:
        candidates = dal.list_active_memories_for_search(conn, {group: "rw"}, group)
        similar = retrieval.find_similar_memories(candidates, title)
        try:
            memory_id = dal.insert_memory(
                conn,
                group_slug=group,
                title=title,
                summary=summary,
                body=body,
                tags=tags or [],
                review_at=stamp,
            )
        except sqlite3.IntegrityError:
            raise ToolError(f"分组 {group} 不存在，拒绝写入") from None
    finally:
        conn.close()
    lines = [f"已新建记忆：{memory_id} | 分组 {group}"]
    if similar:
        lines.append("检测到同分组相似标题（已照常创建，请自行判断是否重复）：")
        lines.extend(
            f"- {item['id']} | 相似度 {item['similarity']} | {item['title']}" for item in similar
        )
    return "\n".join(lines)


@mcp.tool(
    annotations=WRITE_UPDATE,
    description=(
        "局部更新记忆，只传需要修改的字段，需要该分组的 rw 权限。"
        "tags 传 [] 清空标签；clear_review_at 置空复核时间；pinned 传 true 置顶。"
    ),
)
def memory_update(
    id: str,
    title: str | None = None,
    summary: str | None = None,
    body: str | None = None,
    tags: list[str] | None = None,
    review_at: str | None = None,
    clear_review_at: bool = False,
    pinned: bool | None = None,
) -> str:
    if clear_review_at and review_at:
        raise ToolError("clear_review_at 与 review_at 不能同时给出")
    conn = db.connect()
    try:
        _locate_writable(conn, id)
        fields: dict = {}
        if title is not None:
            fields["title"] = _require_text(title, TITLE_MAX, "标题")
        if summary is not None:
            fields["summary"] = _require_text(summary, SUMMARY_MAX, "摘要")
        if body is not None:
            fields["body"] = _require_text(body, BODY_MAX, "正文")
        if tags is not None:
            fields["tags"] = tags
        if pinned is not None:
            fields["pinned"] = int(pinned)
        if clear_review_at:
            fields["review_at"] = None
        elif review_at is not None:
            fields["review_at"] = _parse_review_at(review_at)
        if not fields:
            raise ToolError("至少提供一个待更新字段")
        dal.update_memory(conn, id, fields)
    finally:
        conn.close()
    return f"已更新记忆：{id} | 字段: {', '.join(fields)}"


@mcp.tool(
    annotations=WRITE_DELETE,
    description="软删除记忆并记录原因，需要该分组的 rw 权限；条目进入回收站，可用 CLI 恢复。",
)
def memory_forget(id: str, reason: str) -> str:
    conn = db.connect()
    try:
        _locate_writable(conn, id)
        if reason is None or not reason.strip():
            raise ToolError("删除原因不能为空")
        if not dal.soft_delete_memory(conn, id, reason.strip()):
            raise ToolError(f"记忆 {id} 不存在或无权访问")
    finally:
        conn.close()
    return f"已删除记忆：{id} | 原因: {reason.strip()} | 可用 capsa memory restore {id} 恢复"
