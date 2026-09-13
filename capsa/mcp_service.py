"""FastMCP instance and the four read-only tools."""

from __future__ import annotations

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.types import ToolAnnotations

from capsa import dal, db, formatters, retrieval
from capsa.auth import CapsaTokenVerifier

SEARCH_LIMIT = 20
PEEK_LIMIT = 10
READ_LIMIT = 5

READ_ONLY = ToolAnnotations(readOnlyHint=True)
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
