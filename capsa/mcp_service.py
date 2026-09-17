"""FastMCP instance and the read-write tool set."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.types import ToolAnnotations
from pydantic import Field

from capsa import dal, db, formatters, retrieval
from capsa.auth import CapsaTokenVerifier
from capsa.permissions import permission_for

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


def require_text(value: str | None, limit: int, label: str) -> str:
    """Shared non-empty and length check; returns the value for the caller to store."""
    if value is None or not value.strip():
        raise ToolError(f"{label}不能为空")
    if len(value) > limit:
        raise ToolError(f"{label}超长 (当前 {len(value)} 字符，上限 {limit} 字符，拒绝写入)")
    return value


def _locate_writable(conn, memory_id: str) -> dict:
    """Resolve the target entry and require write permission on its group."""
    item = dal.get_memories_batch_for_access(conn, [memory_id], _grants())[0]
    if item["status"] != "authorized":
        raise ToolError(f"记忆 {memory_id} 不存在或无权访问")
    if permission_for(_grants(), item["group_slug"]) != "rw":
        raise ToolError(f"对分组 {item['group_slug']} 只有只读权限，拒绝修改")
    return item


def _parse_review_at(value: str) -> str:
    try:
        return retrieval.normalize_review_at(value)
    except ValueError:
        raise ToolError(f"review_at 不是合法的 ISO 8601 时间：{value}") from None


@mcp.tool(
    annotations=READ_ONLY,
    description="列出当前凭据可访问的分组、各分组活跃条目数与读写权限。",
)
def memory_groups() -> str:
    scopes = _grants()
    conn = db.connect()
    try:
        return formatters.format_groups(dal.list_groups_with_counts(conn, scopes))
    finally:
        conn.close()


@mcp.tool(
    annotations=READ_ONLY,
    description=(
        "检索记忆条目（返回标题与元数据，不含正文）。仅在标题与摘要未命中特定代码、"
        "配置细节时，可开启 include_body=True 兜底召回。查看摘要请调用 memory_peek，"
        "获取正文请调用 memory_read。"
    ),
)
def memory_search(
    query: Annotated[
        str | None, Field(description="关键词；省略时按置顶与更新时间倒序浏览")
    ] = None,
    group: Annotated[
        str | None, Field(description="只检索该分组；省略时检索凭据可访问的全部分组")
    ] = None,
    limit: Annotated[int, Field(description=f"返回条数上限，取值 1~{SEARCH_LIMIT}")] = 10,
    include_body: Annotated[
        bool,
        Field(
            description=(
                "是否把正文并入检索范围；正文命中权重低于标题与摘要，仅在元数据未命中时开启"
            )
        ),
    ] = False,
) -> str:
    if not 1 <= limit <= SEARCH_LIMIT:
        raise ToolError(f"limit 取值范围为 1~{SEARCH_LIMIT}，本次传入 {limit}")
    # 空 query 是浏览而非检索：正文只服务于关键词兜底，浏览一律不投影正文。
    load_body = bool(include_body and query and query.strip())
    scopes = _grants()
    conn = db.connect()
    try:
        memories = dal.list_active_memories_for_search(conn, scopes, group, include_body=load_body)
    finally:
        conn.close()
    ranked = retrieval.rank_memories(memories, query or "", include_body=load_body)[:limit]
    return formatters.format_search(query or "", ranked, scopes)


@mcp.tool(
    annotations=READ_ONLY,
    description=f"批量查看指定记忆条目的标题与摘要（ids 最多 {PEEK_LIMIT} 条）。获取完整正文请调用 memory_read。",
)
def memory_peek(
    ids: Annotated[list[str], Field(description=f"记忆 id 列表，最多 {PEEK_LIMIT} 条")],
) -> str:
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
        f"批量读取指定记忆条目的完整正文（ids 最多 {READ_LIMIT} 条）。"
        "单条正文过长时支持通过 offset 分页读取。"
    ),
)
def memory_read(
    ids: Annotated[list[str], Field(description=f"记忆 id 列表，最多 {READ_LIMIT} 条")],
    offset: Annotated[
        int,
        Field(
            description=(
                f"单条正文的字符起始偏移，负数按 0 处理；单条最多返回 "
                f"{formatters.MAX_BODY_CHARS} 字符"
            )
        ),
    ] = 0,
) -> str:
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
        f"在指定分组新建记忆（需目标分组写权限）。标题 ≤ {TITLE_MAX}，摘要 ≤ {SUMMARY_MAX}，"
        f"正文 ≤ {BODY_MAX} 字符，超限拒绝写入且不截断。同分组存在相似标题时照常创建并提示。"
    ),
)
def memory_save(
    group: Annotated[str, Field(description="目标分组 slug，需具备该分组的 rw 权限")],
    title: Annotated[str, Field(description=f"标题，不超过 {TITLE_MAX} 字符")],
    summary: Annotated[str, Field(description=f"摘要，不超过 {SUMMARY_MAX} 字符")],
    body: Annotated[str, Field(description=f"正文，不超过 {BODY_MAX} 字符")],
    tags: Annotated[list[str] | None, Field(description="标签列表；省略表示无标签")] = None,
    review_at: Annotated[
        str | None, Field(description="复核时间，ISO 8601；省略表示不设复核")
    ] = None,
) -> str:
    if permission_for(_grants(), group) != "rw":
        raise ToolError(f"对分组 {group} 没有写权限，拒绝写入")
    require_text(title, TITLE_MAX, "标题")
    require_text(summary, SUMMARY_MAX, "摘要")
    require_text(body, BODY_MAX, "正文")
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
    description="局部更新记忆条目（需目标分组写权限）。仅需传入待修改字段。",
)
def memory_update(
    id: Annotated[str, Field(description="目标记忆 id")],
    title: Annotated[str | None, Field(description=f"新标题，不超过 {TITLE_MAX} 字符")] = None,
    summary: Annotated[str | None, Field(description=f"新摘要，不超过 {SUMMARY_MAX} 字符")] = None,
    body: Annotated[str | None, Field(description=f"新正文，不超过 {BODY_MAX} 字符")] = None,
    tags: Annotated[list[str] | None, Field(description="新标签列表；传 [] 清空标签")] = None,
    review_at: Annotated[str | None, Field(description="新复核时间，ISO 8601")] = None,
    clear_review_at: Annotated[bool, Field(description="置空复核时间；与 review_at 互斥")] = False,
    pinned: Annotated[bool | None, Field(description="是否置顶")] = None,
) -> str:
    if clear_review_at and review_at:
        raise ToolError("clear_review_at 与 review_at 不能同时给出")
    conn = db.connect()
    try:
        _locate_writable(conn, id)
        fields: dict = {}
        if title is not None:
            fields["title"] = require_text(title, TITLE_MAX, "标题")
        if summary is not None:
            fields["summary"] = require_text(summary, SUMMARY_MAX, "摘要")
        if body is not None:
            fields["body"] = require_text(body, BODY_MAX, "正文")
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
        if not dal.update_memory(conn, id, fields):
            raise ToolError(f"记忆 {id} 不存在或无权访问")
    finally:
        conn.close()
    return f"已更新记忆：{id} | 字段: {', '.join(fields)}"


@mcp.tool(
    annotations=WRITE_DELETE,
    description="软删除记忆条目并记录原因（需目标分组写权限）。条目移入回收站，可通过 CLI 恢复。",
)
def memory_forget(
    id: Annotated[str, Field(description="目标记忆 id")],
    reason: Annotated[str, Field(description="删除原因，写入回收站记录")],
) -> str:
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
