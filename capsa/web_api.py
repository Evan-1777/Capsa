"""Web RESTful API: unified envelope, Bearer guard and the eight endpoints.

Authorization is shared with the MCP tool layer through the same DAL three-state
judgement and the same field-validation function; only the transport rendering
differs (HTTP status codes versus tool-level isError).
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3

from fastmcp.exceptions import ToolError
from mcp.server.auth.middleware.bearer_auth import BearerAuthBackend
from starlette.applications import Starlette
from starlette.requests import HTTPConnection, Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from capsa import dal, db, retrieval
from capsa.auth import CapsaTokenVerifier, issue_key
from capsa.ids import hash_token
from capsa.mcp_service import BODY_MAX, SUMMARY_MAX, TITLE_MAX, require_text
from capsa.permissions import ADMIN_KEY_ID, permission_for

logger = logging.getLogger(__name__)

# 413 不在此列：1MB 拦截发生在根应用的中间件层，响应体是 starlette 内置的纯文本，
# 不经过本模块的信封。其余五个错误码对应处理器可自行渲染的失败。
UNAUTHORIZED = "UNAUTHORIZED"
FORBIDDEN = "FORBIDDEN"
NOT_FOUND = "NOT_FOUND"
VALIDATION_ERROR = "VALIDATION_ERROR"
INTERNAL_ERROR = "INTERNAL_ERROR"

# 不含调用方传入的 id：条目不存在、已软删除、分组不可见三种情形的 404 响应体
# 必须逐字相同，否则响应体就成了探测未授权分组的侧信道。
_MISSING = "记忆不存在或无权访问"

# 分类字段契约：slug 是记忆外键的落点，创建后不可变，因此首字符也禁止连字符。
_SLUG_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$")
GROUP_NAME_MAX = 60
GROUP_DESC_MAX = 200


def _ok(data, status: int = 200) -> JSONResponse:
    return JSONResponse({"success": True, "data": data, "error": None}, status_code=status)


def _fail(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse(
        {"success": False, "data": None, "error": {"code": code, "message": message}},
        status_code=status,
    )


class BearerAuthGuard:
    """Reject unauthenticated requests before any handler runs.

    Wraps the same backend the MCP endpoint uses, so token parsing and
    revocation behave identically; only the failure rendering differs.
    """

    def __init__(self, app):
        self.app = app
        self.backend = BearerAuthBackend(CapsaTokenVerifier())

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        authenticated = await self.backend.authenticate(HTTPConnection(scope))
        if authenticated is None:
            response = _fail(UNAUTHORIZED, "缺少或无效的 Bearer 令牌", 401)
            return await response(scope, receive, send)
        auth, user = authenticated
        # 管理台只有管理员一种身份：非通配凭据在网关处一律拒绝，处理器不再承担权限分流。
        if user.access_token.claims.get("grants", {}).get("*") != "rw":
            response = _fail(FORBIDDEN, "Web 管理台仅支持管理员凭据访问", 403)
            return await response(scope, receive, send)
        scope["auth"], scope["user"] = auth, user
        await self.app(scope, receive, send)


def _grants(request: Request) -> dict[str, str]:
    """Authorized group to permission map, taken from the verified token claims."""
    token = getattr(request.scope.get("user"), "access_token", None)
    if token is None or not token.claims:
        return {}
    return token.claims.get("grants", {})


def _list_item(row: dict, grants: dict[str, str]) -> dict:
    item = {field: row.get(field) for field in dal.WEB_LIST_FIELDS}
    item["tags"] = json.loads(item["tags"] or "[]")
    item["permission"] = permission_for(grants, item["group_slug"])
    item["is_overdue"] = retrieval.is_expired(item["review_at"])
    return item


def _detail_item(row: dict, grants: dict[str, str]) -> dict:
    item = {field: row[field] for field in dal.WEB_ITEM_FIELDS}
    item["tags"] = json.loads(item["tags"] or "[]")
    item["permission"] = permission_for(grants, item["group_slug"])
    item["is_overdue"] = retrieval.is_expired(item["review_at"])
    return item


def _bounded_int(request: Request, name: str, default: int, minimum: int, maximum: int | None) -> int:
    raw = request.query_params.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ToolError(f"{name} 必须是整数") from None
    if value < minimum or (maximum is not None and value > maximum):
        ceiling = "无上限" if maximum is None else str(maximum)
        raise ToolError(f"{name} 取值范围为 {minimum}~{ceiling}，本次传入 {value}")
    return value


async def _json_body(request: Request) -> dict:
    try:
        payload = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ToolError("请求体不是合法的 JSON") from None
    if not isinstance(payload, dict):
        raise ToolError("请求体必须是 JSON 对象")
    return payload


def _review_at(value) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ToolError(f"review_at 不是合法的 ISO 8601 时间：{value}")
    try:
        return retrieval.normalize_review_at(value)
    except ValueError:
        raise ToolError(f"review_at 不是合法的 ISO 8601 时间：{value}") from None


def _tags(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(tag, str) for tag in value):
        raise ToolError("tags 必须是字符串数组")
    return value


async def auth_me(request: Request) -> JSONResponse:
    key_id = request.user.access_token.claims.get("key_id", "")
    conn = db.connect()
    try:
        key = dal.get_key(conn, key_id)
    finally:
        conn.close()
    if key is None:
        return _fail(UNAUTHORIZED, "凭据无效或已被吊销", 401)
    return _ok({"key_id": key["id"], "name": key["name"], "scopes": key["scopes"]})


async def list_groups(request: Request) -> JSONResponse:
    conn = db.connect()
    try:
        items = dal.list_groups_with_counts(conn, _grants(request))
    finally:
        conn.close()
    return _ok({"items": items, "total": len(items), "offset": 0, "limit": len(items)})


def _group_description(value) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ToolError("分类描述必须是字符串")
    if len(value) > GROUP_DESC_MAX:
        raise ToolError(f"分类描述超长 (当前 {len(value)} 字符，上限 {GROUP_DESC_MAX} 字符)")
    return value


async def group_create(request: Request) -> JSONResponse:
    payload = await _json_body(request)
    slug = payload.get("slug")
    if not isinstance(slug, str) or not _SLUG_PATTERN.fullmatch(slug):
        raise ToolError("slug 只能使用字母、数字、下划线与连字符，长度 1~32 且首字符不能是连字符")
    name = require_text(payload.get("name"), GROUP_NAME_MAX, "分类名称")
    description = _group_description(payload.get("description"))
    conn = db.connect()
    try:
        if not dal.add_group(conn, slug, name, description):
            raise ToolError(f"分组 {slug} 已存在")
        created = dal.list_groups_with_counts(conn, {slug: "rw"})[0]
    finally:
        conn.close()
    return _ok(created)


async def group_update(request: Request) -> JSONResponse:
    slug = request.path_params["slug"]
    payload = await _json_body(request)
    name, description = payload.get("name"), payload.get("description")
    if name is None and description is None:
        raise ToolError("至少提供一个待更新字段")
    conn = db.connect()
    try:
        group = dal.get_group(conn, slug)
        if group is None:
            return _fail(NOT_FOUND, f"分组 {slug} 不存在", 404)
        if name is not None:
            group["name"] = require_text(name, GROUP_NAME_MAX, "分类名称")
        if description is not None:
            group["description"] = _group_description(description)
        dal.update_group(conn, slug, group["name"], group["description"])
        # 响应与 GET /groups 的条目同形：编辑后的卡片直接以列表契约回填。
        updated = dal.list_groups_with_counts(conn, {slug: "rw"})[0]
    finally:
        conn.close()
    return _ok(updated)


async def group_delete(request: Request) -> JSONResponse:
    slug = request.path_params["slug"]
    conn = db.connect()
    try:
        status = dal.delete_empty_group(conn, slug)
    finally:
        conn.close()
    if status == "not_found":
        return _fail(NOT_FOUND, f"分组 {slug} 不存在", 404)
    if status == "has_memories":
        raise ToolError(f"分类 {slug} 下仍有记忆（含回收站），禁止删除")
    return _ok({"slug": slug, "action": "deleted"})


async def memories_list(request: Request) -> JSONResponse:
    status = request.query_params.get("status", "active")
    if status not in ("active", "overdue", "deleted"):
        raise ToolError(f"status 只接受 active / overdue / deleted，本次传入 {status}")
    limit = _bounded_int(request, "limit", 20, 1, 100)
    offset = _bounded_int(request, "offset", 0, 0, None)
    group = request.query_params.get("group") or None
    query = (request.query_params.get("query") or "").strip()
    if query and status != "active":
        raise ToolError("关键词检索只作用于活跃条目，status 需为 active")
    grants = _grants(request)
    conn = db.connect()
    try:
        if query:
            candidates = dal.list_active_memories_for_search(conn, grants, group)
            ranked = retrieval.rank_memories(candidates, query)
            total = len(ranked)
            rows = ranked[offset : offset + limit]
        else:
            rows, total = dal.list_memories_for_web(conn, grants, status, group, offset, limit)
    finally:
        conn.close()
    items = [_list_item(row, grants) for row in rows]
    return _ok({"items": items, "total": total, "offset": offset, "limit": limit})


async def memory_detail(request: Request) -> JSONResponse:
    memory_id = request.path_params["id"]
    grants = _grants(request)
    conn = db.connect()
    try:
        row = dal.get_memory_for_web(conn, memory_id)
    finally:
        conn.close()
    if row is None or row["deleted_at"] is not None or not permission_for(grants, row["group_slug"]):
        return _fail(NOT_FOUND, _MISSING, 404)
    return _ok(_detail_item(row, grants))


async def memory_create(request: Request) -> JSONResponse:
    payload = await _json_body(request)
    group = payload.get("group")
    if not isinstance(group, str) or not group:
        raise ToolError("group 不能为空")
    if permission_for(_grants(request), group) != "rw":
        return _fail(FORBIDDEN, f"对分组 {group} 没有写权限，拒绝写入", 403)
    title = require_text(payload.get("title"), TITLE_MAX, "标题")
    summary = require_text(payload.get("summary"), SUMMARY_MAX, "摘要")
    body = require_text(payload.get("body"), BODY_MAX, "正文")
    tags = _tags(payload.get("tags"))
    stamp = _review_at(payload.get("review_at"))
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
                tags=tags,
                review_at=stamp,
            )
        except sqlite3.IntegrityError:
            raise ToolError(f"分组 {group} 不存在，拒绝写入") from None
    finally:
        conn.close()
    return _ok(
        {
            "id": memory_id,
            "similar_items": [
                {"id": item["id"], "title": item["title"], "similarity": item["similarity"]}
                for item in similar
            ],
        }
    )


def _locate_writable(conn: sqlite3.Connection, memory_id: str, grants: dict[str, str]):
    """Resolve the target and its write permission; returns a response on refusal."""
    item = dal.get_memories_batch_for_access(conn, [memory_id], grants)[0]
    if item["status"] != "authorized":
        return _fail(NOT_FOUND, _MISSING, 404)
    if permission_for(grants, item["group_slug"]) != "rw":
        return _fail(FORBIDDEN, f"对分组 {item['group_slug']} 只有只读权限，拒绝修改", 403)
    return None


async def memory_update(request: Request) -> JSONResponse:
    memory_id = request.path_params["id"]
    payload = await _json_body(request)
    if payload.get("clear_review_at") and payload.get("review_at") is not None:
        raise ToolError("clear_review_at 与 review_at 不能同时给出")
    grants = _grants(request)
    conn = db.connect()
    try:
        refusal = _locate_writable(conn, memory_id, grants)
        if refusal is not None:
            return refusal
        fields: dict = {}
        if payload.get("title") is not None:
            fields["title"] = require_text(payload["title"], TITLE_MAX, "标题")
        if payload.get("summary") is not None:
            fields["summary"] = require_text(payload["summary"], SUMMARY_MAX, "摘要")
        if payload.get("body") is not None:
            fields["body"] = require_text(payload["body"], BODY_MAX, "正文")
        if payload.get("tags") is not None:
            fields["tags"] = _tags(payload["tags"])
        if payload.get("pinned") is not None:
            fields["pinned"] = int(payload["pinned"])
        if payload.get("clear_review_at"):
            fields["review_at"] = None
        elif payload.get("review_at") is not None:
            fields["review_at"] = _review_at(payload["review_at"])
        if not fields:
            raise ToolError("至少提供一个待更新字段")
        if not dal.update_memory(conn, memory_id, fields):
            return _fail(NOT_FOUND, _MISSING, 404)
    finally:
        conn.close()
    return _ok({"id": memory_id, "action": "updated"})


async def memory_delete(request: Request) -> JSONResponse:
    memory_id = request.path_params["id"]
    payload = await _json_body(request)
    grants = _grants(request)
    conn = db.connect()
    try:
        refusal = _locate_writable(conn, memory_id, grants)
        if refusal is not None:
            return refusal
        reason = payload.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise ToolError("删除原因不能为空")
        if not dal.soft_delete_memory(conn, memory_id, reason.strip()):
            return _fail(NOT_FOUND, _MISSING, 404)
    finally:
        conn.close()
    return _ok({"id": memory_id, "action": "deleted"})


async def memory_restore(request: Request) -> JSONResponse:
    memory_id = request.path_params["id"]
    grants = _grants(request)
    conn = db.connect()
    try:
        row = dal.get_memory_for_web(conn, memory_id)
        if row is None or permission_for(grants, row["group_slug"]) is None:
            return _fail(NOT_FOUND, _MISSING, 404)
        if permission_for(grants, row["group_slug"]) != "rw":
            return _fail(FORBIDDEN, f"对分组 {row['group_slug']} 只有只读权限，拒绝修改", 403)
        if row["deleted_at"] is None:
            return _fail(NOT_FOUND, _MISSING, 404)
        dal.restore_memory(conn, memory_id)
    finally:
        conn.close()
    return _ok({"id": memory_id, "action": "restored"})


KEY_NAME_MAX = 60


def _check_key_guard(request: Request, target_id: str) -> None:
    current_key_id = request.user.access_token.claims.get("key_id")
    if current_key_id == target_id:
        raise ToolError("禁止对当前正在使用的管理凭据执行吊销或删除操作")
    if target_id == ADMIN_KEY_ID:
        raise ToolError("环境变量管理员凭据不受管理接口支持，请通过环境变量变更或重启服务完成轮换")


async def key_list(request: Request) -> JSONResponse:
    conn = db.connect()
    try:
        items = dal.list_keys(conn)
    finally:
        conn.close()
    return _ok({"items": items, "total": len(items), "offset": 0, "limit": len(items)})


async def key_create(request: Request) -> JSONResponse:
    payload = await _json_body(request)
    name = require_text(payload.get("name"), KEY_NAME_MAX, "Key 名称")
    scopes = payload.get("scopes")
    if not isinstance(scopes, dict) or not scopes:
        raise ToolError("scopes 必须是非空字典")
    conn = db.connect()
    try:
        existing_groups = {g["slug"] for g in dal.list_groups(conn)}
        for slug, perm in scopes.items():
            if not isinstance(slug, str) or (slug != "*" and slug not in existing_groups):
                raise ToolError(f"分组 {slug} 不存在")
            if perm not in ("r", "rw"):
                raise ToolError(f"权限值必须是 r 或 rw，本次传入 {perm}")
        key_id, plain_token = issue_key()
        created_at = db.utcnow()
        dal.create_key(conn, key_id, name, hash_token(plain_token), scopes)
    finally:
        conn.close()
    return _ok(
        {
            "id": key_id,
            "name": name,
            "token": plain_token,
            "scopes": scopes,
            "created_at": created_at,
        },
        status=201,
    )


async def key_revoke(request: Request) -> JSONResponse:
    target_id = request.path_params["id"]
    _check_key_guard(request, target_id)
    conn = db.connect()
    try:
        status = dal.revoke_key(conn, target_id)
    finally:
        conn.close()
    if status == "not_found":
        return _fail(NOT_FOUND, f"Key {target_id} 不存在", 404)
    if status == "already_revoked":
        raise ToolError(f"Key {target_id} 已经处于吊销状态")
    return _ok({"id": target_id, "action": "revoked"})


async def key_delete(request: Request) -> JSONResponse:
    target_id = request.path_params["id"]
    _check_key_guard(request, target_id)
    conn = db.connect()
    try:
        status = dal.delete_revoked_key(conn, target_id)
    finally:
        conn.close()
    if status == "not_found":
        return _fail(NOT_FOUND, f"Key {target_id} 不存在", 404)
    if status == "still_active":
        raise ToolError(f"Key {target_id} 仍处于有效状态，请先吊销后再删除")
    return _ok({"id": target_id, "action": "deleted"})


async def tool_error_handler(request: Request, exc: ToolError) -> JSONResponse:
    return _fail(VALIDATION_ERROR, str(exc), 422)


async def internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Web API 未处理异常: %s", exc, exc_info=exc)
    return _fail(INTERNAL_ERROR, "服务内部错误", 500)


routes = [
    Route("/auth/me", endpoint=auth_me, methods=["GET"]),
    Route("/groups", endpoint=list_groups, methods=["GET"]),
    Route("/memories", endpoint=memories_list, methods=["GET"]),
    Route("/memories", endpoint=memory_create, methods=["POST"]),
    Route("/memories/{id}", endpoint=memory_detail, methods=["GET"]),
    Route("/memories/{id}", endpoint=memory_update, methods=["PUT"]),
    Route("/memories/{id}", endpoint=memory_delete, methods=["DELETE"]),
    Route("/memories/{id}/restore", endpoint=memory_restore, methods=["POST"]),
    Route("/groups", endpoint=group_create, methods=["POST"]),
    Route("/groups/{slug}", endpoint=group_update, methods=["PUT"]),
    Route("/groups/{slug}", endpoint=group_delete, methods=["DELETE"]),
    Route("/keys", endpoint=key_list, methods=["GET"]),
    Route("/keys", endpoint=key_create, methods=["POST"]),
    Route("/keys/{id}/revoke", endpoint=key_revoke, methods=["POST"]),
    Route("/keys/{id}", endpoint=key_delete, methods=["DELETE"]),
]

web_api_app = Starlette(
    routes=routes,
    exception_handlers={ToolError: tool_error_handler, Exception: internal_error_handler},
)
web_api_app.add_middleware(BearerAuthGuard)
