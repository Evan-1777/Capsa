"""Web API contracts: envelope, error mapping and authorization symmetry."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

import pytest

from capsa import dal, db, retrieval
from capsa.ids import hash_token
from capsa.mcp_service import SUMMARY_MAX, TITLE_MAX
from capsa.web_api import (
    FORBIDDEN,
    GROUP_DESC_MAX,
    GROUP_NAME_MAX,
    INTERNAL_ERROR,
    NOT_FOUND,
    UNAUTHORIZED,
    VALIDATION_ERROR,
)
from tests.conftest import PROJ_MEMORY, STUDY_MEMORY, create_key, insert_memory, web_headers

ENVELOPE_KEYS = {"success", "data", "error"}
LIST_META_KEYS = {"items", "total", "offset", "limit"}
ITEM_EXTRA = {"permission", "is_overdue"}
PAST = "2000-01-01T00:00:00+00:00"
FUTURE = "2035-01-01T00:00:00+00:00"


def item_keys() -> set[str]:
    return set(dal.WEB_LIST_FIELDS) | ITEM_EXTRA


def assert_failure(response, status: int, code: str) -> dict:
    assert response.status_code == status
    body = response.json()
    assert set(body) == ENVELOPE_KEYS
    assert body["success"] is False
    assert body["data"] is None
    assert body["error"]["code"] == code
    return body


def create(client, token, **overrides):
    payload = {
        "group": "proj",
        "title": "新建条目",
        "summary": "摘要",
        "body": "正文",
        **overrides,
    }
    return client.post("/api/memories", headers=web_headers(token), json=payload)


# --- TASK-034 信封、Bearer 守卫与身份端点 ---


def test_auth_me_requires_a_bearer_token(client):
    body = assert_failure(client.get("/api/auth/me"), 401, UNAUTHORIZED)
    assert body["error"]["message"]


def test_auth_me_rejects_an_invalid_token(client):
    assert_failure(client.get("/api/auth/me", headers=web_headers("capsa_nope")), 401, UNAUTHORIZED)


def test_revoked_token_is_rejected_on_the_next_request(client, seeded):
    conn = db.connect()
    try:
        temporary = create_key(conn, "临时管理员", {"*": "rw"})
    finally:
        conn.close()
    headers = web_headers(temporary["token"])
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    conn = db.connect()
    try:
        assert dal.revoke_key(conn, temporary["id"]) == "revoked"
    finally:
        conn.close()
    assert_failure(client.get("/api/auth/me", headers=headers), 401, UNAUTHORIZED)


def test_auth_me_returns_the_issued_scopes(client, seeded):
    response = client.get("/api/auth/me", headers=web_headers(seeded["admin"]["token"]))
    assert response.status_code == 200
    body = response.json()
    assert set(body) == ENVELOPE_KEYS
    assert body["error"] is None
    assert body["data"] == {
        "key_id": seeded["admin"]["id"],
        "name": "admin-key",
        "scopes": {"*": "rw"},
    }


def test_groups_lists_every_group_for_the_admin(client, seeded):
    response = client.get("/api/groups", headers=web_headers(seeded["admin"]["token"]))
    assert response.status_code == 200
    data = response.json()["data"]
    assert set(data) == LIST_META_KEYS
    assert data["total"] == 2
    assert data["offset"] == 0
    assert data["limit"] == 2
    assert data["items"] == [
        {
            "slug": "proj",
            "name": "项目",
            "description": "项目记忆",
            "count": 1,
            "permission": "rw",
        },
        {
            "slug": "study",
            "name": "学习",
            "description": "学习笔记",
            "count": 1,
            "permission": "rw",
        },
    ]


def test_unexpected_exception_returns_the_internal_envelope(conn, seeded, monkeypatch):
    """处理器外的兜底先发出 500 信封再向服务器重抛异常；测试客户端默认重抛该异常，
    因此这里显式关闭重抛，验证的是真实客户端会收到的响应体。"""
    from starlette.testclient import TestClient

    from capsa.server import app

    def explode(*args, **kwargs):
        raise RuntimeError("内部堆栈细节不应出现在响应体")

    monkeypatch.setattr(dal, "list_groups_with_counts", explode)
    with TestClient(app, raise_server_exceptions=False) as local:
        body = assert_failure(
            local.get("/api/groups", headers=web_headers(seeded["admin"]["token"])), 500, INTERNAL_ERROR
        )
    assert body["error"]["message"] == "服务内部错误"
    assert "RuntimeError" not in json.dumps(body, ensure_ascii=False)
    assert "内部堆栈细节" not in json.dumps(body, ensure_ascii=False)


# --- TASK-035 记忆列表与详情 ---


def test_memories_list_envelope_and_item_contract(client, seeded):
    response = client.get("/api/memories", headers=web_headers(seeded["admin"]["token"]))
    assert response.status_code == 200
    body = response.json()
    assert set(body) == ENVELOPE_KEYS
    assert body["error"] is None
    data = body["data"]
    assert set(data) == LIST_META_KEYS
    assert (data["total"], data["offset"], data["limit"]) == (2, 0, 20)
    assert set(data["items"][0]) == item_keys() | {"is_overdue"}
    assert data["items"][0]["id"] == PROJ_MEMORY
    assert data["items"][0]["tags"] == []
    assert data["items"][0]["deleted_at"] is None
    assert data["items"][0]["deleted_reason"] is None
    assert "body" not in data["items"][0]
    assert "created_at" not in data["items"][0]


def test_memories_list_query_branch_shares_the_item_contract(client, seeded):
    response = client.get(
        "/api/memories",
        headers=web_headers(seeded["admin"]["token"]),
        params={"query": "模型架构"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["total"] == 0

    insert_memory(conn := db.connect(), "mem_bigram", "proj", "MCP 授权模型与设计架构")
    conn.close()
    response = client.get(
        "/api/memories",
        headers=web_headers(seeded["admin"]["token"]),
        params={"query": "模型架构"},
    )
    data = response.json()["data"]
    assert [item["id"] for item in data["items"]] == ["mem_bigram"]
    assert data["total"] == 1
    assert set(data["items"][0]) == item_keys() | {"is_overdue"}
    assert data["items"][0]["deleted_at"] is None


def test_memories_list_pagination_is_stable(client, seeded):
    conn = db.connect()
    try:
        insert_memory(conn, "mem_page02", "proj", "第二条", updated_at="2026-04-01T08:00:00+00:00")
    finally:
        conn.close()
    headers = web_headers(seeded["admin"]["token"])
    page = client.get("/api/memories", headers=headers, params={"limit": 1, "offset": 1}).json()["data"]
    everything = client.get("/api/memories", headers=headers, params={"limit": 100}).json()["data"]
    assert page["total"] == everything["total"] == 3
    assert page["items"][0]["id"] == everything["items"][1]["id"]


def test_memories_list_status_filters(client, seeded):
    conn = db.connect()
    try:
        insert_memory(conn, "mem_over", "proj", "过期待办", review_at=PAST)
        insert_memory(conn, "mem_live", "proj", "未到期待办", review_at=FUTURE)
        conn.execute(
            "UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?",
            (db.utcnow(), "归档", "mem_live"),
        )
        conn.commit()
    finally:
        conn.close()
    headers = web_headers(seeded["admin"]["token"])
    overdue = client.get("/api/memories", headers=headers, params={"status": "overdue"}).json()["data"]
    assert [item["id"] for item in overdue["items"]] == ["mem_over"]
    deleted = client.get("/api/memories", headers=headers, params={"status": "deleted"}).json()["data"]
    assert [item["id"] for item in deleted["items"]] == ["mem_live"]
    assert deleted["items"][0]["deleted_reason"] == "归档"
    assert deleted["items"][0]["is_overdue"] is False


def test_non_admin_key_is_rejected_before_any_handler(client, seeded):
    """绕过前端的直接调用同样被网关拦截：普通分组 Key 触达不到任何处理器。"""
    headers = web_headers(seeded["proj"]["token"])
    for path in ("/api/auth/me", "/api/groups", "/api/memories"):
        body = assert_failure(client.get(path, headers=headers), 403, FORBIDDEN)
        assert body["error"]["message"] == "Web 管理台仅支持管理员凭据访问"


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 101},
        {"status": "unknown"},
        {"offset": -1},
        {"query": "密钥", "status": "deleted"},
    ],
)
def test_memories_list_rejects_bad_parameters(client, seeded, params):
    response = client.get("/api/memories", headers=web_headers(seeded["admin"]["token"]), params=params)
    assert_failure(response, 422, VALIDATION_ERROR)


def test_api_prefix_is_never_hijacked_by_static_mount(client, seeded):
    response = client.get("/api/memories", headers=web_headers(seeded["admin"]["token"]))
    assert response.headers["content-type"].startswith("application/json")


def test_memory_detail_returns_the_full_body(client, seeded, conn):
    body = "甲" * 6000
    insert_memory(conn, "mem_long", "proj", "长文", body=body)
    response = client.get("/api/memories/mem_long", headers=web_headers(seeded["admin"]["token"]))
    assert response.status_code == 200
    data = response.json()["data"]
    assert set(data) == set(dal.WEB_ITEM_FIELDS) | ITEM_EXTRA
    assert data["body"] == body
    assert data["is_overdue"] is False


def test_detail_deleted_and_missing_ids_are_indistinguishable(client, seeded, conn):
    headers = web_headers(seeded["admin"]["token"])
    conn.execute(
        "UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?",
        (db.utcnow(), "归档", PROJ_MEMORY),
    )
    conn.commit()
    deleted = client.get(f"/api/memories/{PROJ_MEMORY}", headers=headers)
    missing = client.get("/api/memories/mem_zzz999", headers=headers)
    assert_failure(deleted, 404, NOT_FOUND)
    assert deleted.json() == missing.json()
    assert PROJ_MEMORY not in deleted.text
    assert "项目密钥轮换方案" not in deleted.text


def test_detail_hides_soft_deleted_entries(client, seeded, conn):
    conn.execute(
        "UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?",
        (db.utcnow(), "归档", PROJ_MEMORY),
    )
    conn.commit()
    response = client.get(f"/api/memories/{PROJ_MEMORY}", headers=web_headers(seeded["admin"]["token"]))
    assert_failure(response, 404, NOT_FOUND)


# --- TASK-036 写入端点 ---


def test_create_returns_an_id_readable_through_detail(client, seeded):
    response = create(client, seeded["admin"]["token"], title="可读回", tags=["a", "b"])
    assert response.status_code == 200
    data = response.json()["data"]
    assert re.fullmatch(r"mem_[a-z0-9]{6}", data["id"])
    assert data["similar_items"] == []
    detail = client.get(f"/api/memories/{data['id']}", headers=web_headers(seeded["admin"]["token"]))
    assert detail.json()["data"]["title"] == "可读回"
    assert detail.json()["data"]["tags"] == ["a", "b"]


def test_create_into_a_missing_group_is_rejected(client, seeded, conn):
    before = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
    response = create(client, seeded["admin"]["token"], group="ghost")
    assert_failure(response, 422, VALIDATION_ERROR)
    assert response.json()["error"]["message"] == "分组 ghost 不存在，拒绝写入"
    assert conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == before


def test_create_over_limit_matches_the_mcp_message(client, seeded, open_session):
    session = open_session(seeded["admin"]["token"])
    mcp = session.call(
        "memory_save",
        {"group": "proj", "title": "标" * (TITLE_MAX + 1), "summary": "摘要", "body": "正文"},
    )
    web = create(client, seeded["admin"]["token"], title="标" * (TITLE_MAX + 1))
    assert_failure(web, 422, VALIDATION_ERROR)
    assert web.json()["error"]["message"] == mcp["content"][0]["text"]


def test_create_reports_similar_items_but_still_stores(client, seeded, conn):
    first = create(client, seeded["admin"]["token"], title="记忆分组表").json()["data"]["id"]
    response = create(client, seeded["admin"]["token"], title="记忆分组")
    assert response.status_code == 200
    similar = response.json()["data"]["similar_items"]
    assert [item["id"] for item in similar] == [first]
    assert set(similar[0]) == {"id", "title", "similarity"}
    assert similar[0]["similarity"] == pytest.approx(0.75)
    assert conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 4


def test_update_touches_only_the_given_fields(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    before = client.get(f"/api/memories/{PROJ_MEMORY}", headers=headers).json()["data"]
    response = client.put(f"/api/memories/{PROJ_MEMORY}", headers=headers, json={"title": "改名"})
    assert response.status_code == 200
    assert response.json()["data"] == {"id": PROJ_MEMORY, "action": "updated"}
    after = client.get(f"/api/memories/{PROJ_MEMORY}", headers=headers).json()["data"]
    assert after["title"] == "改名"
    for field in ("summary", "body", "tags", "review_at", "pinned", "created_at", "group_slug"):
        assert after[field] == before[field]


def test_update_clears_and_sets_review_at(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    assert client.put(
        f"/api/memories/{PROJ_MEMORY}", headers=headers, json={"review_at": PAST}
    ).status_code == 200
    assert client.get(f"/api/memories/{PROJ_MEMORY}", headers=headers).json()["data"]["is_overdue"] is True
    assert client.put(
        f"/api/memories/{PROJ_MEMORY}", headers=headers, json={"clear_review_at": True}
    ).status_code == 200
    assert client.get(f"/api/memories/{PROJ_MEMORY}", headers=headers).json()["data"]["review_at"] is None


@pytest.mark.parametrize(
    "payload",
    [{}, {"clear_review_at": True, "review_at": FUTURE}, {"title": "  "}],
)
def test_update_rejects_empty_or_conflicting_payloads(client, seeded, payload):
    response = client.put(
        f"/api/memories/{PROJ_MEMORY}", headers=web_headers(seeded["admin"]["token"]), json=payload
    )
    assert_failure(response, 422, VALIDATION_ERROR)


def test_put_on_a_missing_id_is_opaque(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    missing = client.put("/api/memories/mem_zzz999", headers=headers, json={"title": "x"})
    assert_failure(missing, 404, NOT_FOUND)
    assert missing.json()["error"]["message"] == "记忆不存在或无权访问"


def test_delete_moves_the_entry_to_the_recycle_bin(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    response = client.request(
        "DELETE", f"/api/memories/{PROJ_MEMORY}", headers=headers, json={"reason": "不再需要"}
    )
    assert response.status_code == 200
    assert response.json()["data"] == {"id": PROJ_MEMORY, "action": "deleted"}
    active = client.get("/api/memories", headers=headers).json()["data"]
    assert [item["id"] for item in active["items"]] == [STUDY_MEMORY]
    deleted = client.get("/api/memories", headers=headers, params={"status": "deleted"}).json()["data"]
    assert [item["id"] for item in deleted["items"]] == [PROJ_MEMORY]
    assert deleted["items"][0]["deleted_reason"] == "不再需要"
    assert deleted["items"][0]["deleted_at"] is not None


@pytest.mark.parametrize("reason", ["", "   "])
def test_delete_requires_a_reason(client, seeded, conn, reason):
    response = client.request(
        "DELETE", f"/api/memories/{PROJ_MEMORY}", headers=web_headers(seeded["admin"]["token"]), json={"reason": reason}
    )
    assert_failure(response, 422, VALIDATION_ERROR)
    assert response.json()["error"]["message"] == "删除原因不能为空"
    assert conn.execute("SELECT deleted_at FROM memories WHERE id = ?", (PROJ_MEMORY,)).fetchone()[0] is None


def test_restore_returns_the_entry_to_the_workbench(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    client.request("DELETE", f"/api/memories/{PROJ_MEMORY}", headers=headers, json={"reason": "误删"})
    response = client.post(f"/api/memories/{PROJ_MEMORY}/restore", headers=headers)
    assert response.status_code == 200
    assert response.json()["data"] == {"id": PROJ_MEMORY, "action": "restored"}
    active = client.get("/api/memories", headers=headers).json()["data"]
    assert [item["id"] for item in active["items"]] == [PROJ_MEMORY, STUDY_MEMORY]
    deleted = client.get("/api/memories", headers=headers, params={"status": "deleted"}).json()["data"]
    assert deleted["items"] == []


def test_restore_rejects_live_entries_and_non_admin_keys(client, seeded, conn):
    headers = web_headers(seeded["admin"]["token"])
    assert_failure(client.post(f"/api/memories/{PROJ_MEMORY}/restore", headers=headers), 404, NOT_FOUND)
    denied = client.post(
        f"/api/memories/{PROJ_MEMORY}/restore", headers=web_headers(seeded["proj"]["token"])
    )
    assert_failure(denied, 403, FORBIDDEN)
    assert denied.json()["error"]["message"] == "Web 管理台仅支持管理员凭据访问"


def test_oversized_body_is_rejected_on_the_api_prefix(client, seeded):
    response = client.post(
        "/api/memories",
        headers=web_headers(seeded["admin"]["token"]),
        content=b"x" * 1_100_000,
    )
    assert response.status_code == 413


# --- TASK-033 DAL Web 入口 ---


def test_web_list_fields_match_the_constant(conn, seeded):
    items, total = dal.list_memories_for_web(conn, {"proj": "rw"}, "active")
    assert total == 1
    assert set(items[0]) == set(dal.WEB_LIST_FIELDS)
    assert "body" not in items[0]


def test_web_list_status_boundaries_and_scopes(conn, seeded):
    now = datetime.now(timezone.utc)
    insert_memory(conn, "mem_soon", "proj", "刚过期", review_at=(now - timedelta(seconds=1)).isoformat())
    insert_memory(conn, "mem_later", "proj", "未过期", review_at=(now + timedelta(days=1)).isoformat())
    overdue, total = dal.list_memories_for_web(conn, {"proj": "rw"}, "overdue")
    assert [row["id"] for row in overdue] == ["mem_soon"]
    assert total == 1
    assert [row["id"] for row in dal.list_memories_for_web(conn, {"study": "rw"}, "active")[0]] == [STUDY_MEMORY]
    assert dal.list_memories_for_web(conn, {}, "active") == ([], 0)
    assert dal.list_memories_for_web(conn, {"proj": "rw"}, "active", group="study") == ([], 0)


def test_web_list_pages_share_the_same_total(conn, seeded):
    insert_memory(conn, "mem_page02", "proj", "第二条", updated_at="2026-04-01T08:00:00+00:00")
    first, total_one = dal.list_memories_for_web(conn, {"proj": "rw"}, "active", offset=1, limit=1)
    whole, total_all = dal.list_memories_for_web(conn, {"proj": "rw"}, "active", limit=20)
    assert total_one == total_all == 2
    assert first[0]["id"] == whole[1]["id"]


def test_get_memory_for_web_keeps_deleted_entries(conn, seeded):
    conn.execute(
        "UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?",
        (db.utcnow(), "误删", PROJ_MEMORY),
    )
    conn.commit()
    row = dal.get_memory_for_web(conn, PROJ_MEMORY)
    assert row is not None and row["deleted_at"] is not None
    assert set(row) == set(dal.WEB_ITEM_FIELDS)
    assert dal.get_memories_batch_for_access(conn, [PROJ_MEMORY], {"proj": "rw"})[0]["status"] == "not_found"
    assert dal.get_memory_for_web(conn, "mem_zzz999") is None


def test_get_key_round_trips_scopes(conn):
    key = create_key(conn, "查询", {"proj": "rw", "study": "r"})
    assert dal.get_key(conn, key["id"]) == {
        "id": key["id"],
        "name": "查询",
        "scopes": {"proj": "rw", "study": "r"},
    }
    assert dal.get_key(conn, "nope0000") is None


def test_dal_never_filters_keywords_in_sql():
    import inspect

    source = inspect.getsource(dal)
    assert "LIKE" not in source
    assert "query" not in inspect.signature(dal.list_memories_for_web).parameters


# --- TASK-001/002 单管理员凭据与通配管理员 ---


def test_admin_token_lifecycle_and_blank_handling(bare_client, seeded, monkeypatch):
    """管理级环境变量：空白视为未启用，改值即时生效，未配置时数据库校验照常。"""
    monkeypatch.setenv("CAPSA_ADMIN_TOKEN", "   ")
    assert_failure(bare_client.get("/api/auth/me", headers=web_headers("   ")), 401, UNAUTHORIZED)

    monkeypatch.setenv("CAPSA_ADMIN_TOKEN", "vps-admin-secret")
    response = bare_client.get("/api/auth/me", headers=web_headers("vps-admin-secret"))
    assert response.status_code == 200
    assert response.json()["data"] == {"key_id": "admin", "name": "Admin", "scopes": {"*": "rw"}}

    monkeypatch.setenv("CAPSA_ADMIN_TOKEN", "rotated")
    assert_failure(
        bare_client.get("/api/auth/me", headers=web_headers("vps-admin-secret")), 401, UNAUTHORIZED
    )
    assert bare_client.get("/api/auth/me", headers=web_headers("rotated")).status_code == 200

    monkeypatch.delenv("CAPSA_ADMIN_TOKEN")
    stored = bare_client.get("/api/auth/me", headers=web_headers(seeded["admin"]["token"]))
    assert stored.json()["data"]["scopes"] == {"*": "rw"}


# --- TASK-004/005 分类生命周期 ---


def test_create_group_atomic_and_reflected_in_list(client, seeded, conn):
    headers = web_headers(seeded["admin"]["token"])
    response = client.post(
        "/api/groups", headers=headers, json={"slug": "lab", "name": "实验室", "description": "实验记录"}
    )
    assert response.status_code == 200
    assert response.json()["data"] == {
        "slug": "lab",
        "name": "实验室",
        "description": "实验记录",
        "count": 0,
        "permission": "rw",
    }
    listed = client.get("/api/groups", headers=headers).json()["data"]
    assert [item["slug"] for item in listed["items"]] == ["lab", "proj", "study"]
    assert conn.execute("SELECT COUNT(*) FROM groups WHERE slug = ?", ("lab",)).fetchone()[0] == 1


@pytest.mark.parametrize("payload", [
    {"slug": "proj", "name": "重复"},
    {"slug": "-bad", "name": "非法"},
    {"slug": "有 空格", "name": "非法"},
    {"slug": "x" * 33, "name": "非法"},
    {"slug": "", "name": "非法"},
    {"slug": "中文", "name": "非法"},
    {"slug": "lab", "name": "   "},
    {"slug": "lab", "name": "名" * (GROUP_NAME_MAX + 1)},
    {"slug": "lab", "name": "合法", "description": "描" * (GROUP_DESC_MAX + 1)},
])
def test_create_group_rejects_duplicate_or_invalid_fields(client, seeded, conn, payload):
    before = conn.execute("SELECT COUNT(*) FROM groups").fetchone()[0]
    response = client.post(
        "/api/groups", headers=web_headers(seeded["admin"]["token"]), json=payload
    )
    assert_failure(response, 422, VALIDATION_ERROR)
    assert conn.execute("SELECT COUNT(*) FROM groups").fetchone()[0] == before


def test_update_group_name_and_description(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    response = client.put(
        "/api/groups/proj", headers=headers, json={"name": "项目二部", "description": "新描述"}
    )
    assert response.status_code == 200
    assert response.json()["data"] == {
        "slug": "proj",
        "name": "项目二部",
        "description": "新描述",
        "count": 1,
        "permission": "rw",
    }
    partial = client.put("/api/groups/proj", headers=headers, json={"name": "项目三部"})
    assert partial.json()["data"]["name"] == "项目三部"
    assert partial.json()["data"]["description"] == "新描述"

    missing = client.put("/api/groups/ghost", headers=headers, json={"name": "x"})
    body = assert_failure(missing, 404, NOT_FOUND)
    assert body["error"]["message"] == "分组 ghost 不存在"
    assert_failure(client.put("/api/groups/proj", headers=headers, json={}), 422, VALIDATION_ERROR)


def test_foreign_key_safety_when_group_updated(client, seeded, conn):
    headers = web_headers(seeded["admin"]["token"])
    assert client.put("/api/groups/proj", headers=headers, json={"name": "项目二部"}).status_code == 200
    # slug 不可变，已有记忆的外键始终指向同一个分组。
    assert conn.execute(
        "SELECT group_slug FROM memories WHERE id = ?", (PROJ_MEMORY,)
    ).fetchone()[0] == "proj"
    detail = client.get(f"/api/memories/{PROJ_MEMORY}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["data"]["group_slug"] == "proj"


def test_group_writes_stay_behind_the_admin_gate(client, seeded):
    headers = web_headers(seeded["proj"]["token"])
    created = client.post("/api/groups", headers=headers, json={"slug": "lab", "name": "实验室"})
    updated = client.put("/api/groups/proj", headers=headers, json={"name": "改名"})
    for response in (created, updated):
        assert_failure(response, 403, FORBIDDEN)

# --- TASK-012 分类删除与 Key 生命周期全量测试 ---


def test_delete_empty_group_succeeds(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    client.post("/api/groups", headers=headers, json={"slug": "temp_empty", "name": "临时空分组"})
    response = client.delete("/api/groups/temp_empty", headers=headers)
    assert response.status_code == 200
    assert response.json()["data"] == {"slug": "temp_empty", "action": "deleted"}
    listed = client.get("/api/groups", headers=headers).json()["data"]["items"]
    assert "temp_empty" not in [g["slug"] for g in listed]


def test_delete_missing_group_returns_404(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    response = client.delete("/api/groups/ghost_group", headers=headers)
    assert_failure(response, 404, NOT_FOUND)
    assert response.json()["error"]["message"] == "分组 ghost_group 不存在"


def test_delete_group_with_active_memories_returns_422(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    response = client.delete("/api/groups/proj", headers=headers)
    assert_failure(response, 422, VALIDATION_ERROR)
    assert "分类 proj 下仍有记忆（含回收站），禁止删除" in response.json()["error"]["message"]


def test_delete_group_with_soft_deleted_memories_returns_422(client, seeded, conn):
    headers = web_headers(seeded["admin"]["token"])
    client.post("/api/groups", headers=headers, json={"slug": "temp_soft", "name": "软删除分组"})
    insert_memory(conn, "mem_soft_del", "temp_soft", "将要软删除")
    conn.execute(
        "UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?",
        (db.utcnow(), "测试软删除", "mem_soft_del"),
    )
    conn.commit()

    response = client.delete("/api/groups/temp_soft", headers=headers)
    assert_failure(response, 422, VALIDATION_ERROR)
    assert "分类 temp_soft 下仍有记忆（含回收站），禁止删除" in response.json()["error"]["message"]


def test_key_create_and_list_lifecycle(client, seeded, conn, monkeypatch):
    monkeypatch.setenv("CAPSA_ADMIN_TOKEN", "vps-virtual-admin")
    headers = web_headers(seeded["admin"]["token"])
    create_resp = client.post(
        "/api/keys",
        headers=headers,
        json={"name": "新测试Key", "scopes": {"proj": "rw"}},
    )
    assert create_resp.status_code == 201
    data = create_resp.json()["data"]
    key_id = data["id"]
    token = data["token"]
    assert data["name"] == "新测试Key"
    assert data["scopes"] == {"proj": "rw"}
    assert len(token) == 47 and token.startswith(f"capsa_{key_id}_")

    # 校验哈希落库
    row = conn.execute("SELECT token_hash FROM keys WHERE id = ?", (key_id,)).fetchone()
    assert row[0] == hash_token(token)

    # 校验列表查询且不混入虚拟环境变量管理员
    list_resp = client.get("/api/keys", headers=headers)
    assert list_resp.status_code == 200
    items = list_resp.json()["data"]["items"]
    ids = [item["id"] for item in items]
    assert key_id in ids
    assert "admin" not in ids


def test_key_create_rejects_empty_or_invalid_scopes(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    assert_failure(
        client.post("/api/keys", headers=headers, json={"name": "空scope", "scopes": {}}),
        422,
        VALIDATION_ERROR,
    )
    assert_failure(
        client.post("/api/keys", headers=headers, json={"name": "非法group", "scopes": {"ghost": "rw"}}),
        422,
        VALIDATION_ERROR,
    )
    assert_failure(
        client.post("/api/keys", headers=headers, json={"name": "非法perm", "scopes": {"proj": "super"}}),
        422,
        VALIDATION_ERROR,
    )
    assert_failure(
        client.post("/api/keys", headers=headers, json={"name": "   ", "scopes": {"proj": "rw"}}),
        422,
        VALIDATION_ERROR,
    )


def test_key_revoke_and_delete_lifecycle(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    created = client.post(
        "/api/keys",
        headers=headers,
        json={"name": "待吊销", "scopes": {"proj": "r"}},
    ).json()["data"]
    k_id, k_token = created["id"], created["token"]

    # 1. 吊销
    revoke_resp = client.post(f"/api/keys/{k_id}/revoke", headers=headers)
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["data"] == {"id": k_id, "action": "revoked"}

    # 2. 重复吊销报 422
    assert_failure(client.post(f"/api/keys/{k_id}/revoke", headers=headers), 422, VALIDATION_ERROR)

    # 3. 使用已吊销令牌发起请求报 401
    assert client.get("/api/auth/me", headers=web_headers(k_token)).status_code == 401

    # 4. 物理删除已吊销 Key
    del_resp = client.delete(f"/api/keys/{k_id}", headers=headers)
    assert del_resp.status_code == 200
    assert del_resp.json()["data"] == {"id": k_id, "action": "deleted"}

    # 5. 再次删除报 404
    assert_failure(client.delete(f"/api/keys/{k_id}", headers=headers), 404, NOT_FOUND)


def test_key_delete_requires_prior_revocation(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    created = client.post(
        "/api/keys",
        headers=headers,
        json={"name": "活跃未吊销", "scopes": {"proj": "r"}},
    ).json()["data"]
    k_id = created["id"]

    # 未吊销直接删除报 422
    resp = client.delete(f"/api/keys/{k_id}", headers=headers)
    assert_failure(resp, 422, VALIDATION_ERROR)
    assert "仍处于有效状态，请先吊销后再删除" in resp.json()["error"]["message"]


def test_key_operations_prevent_self_lock_and_virtual_admin(client, seeded):
    headers = web_headers(seeded["admin"]["token"])
    admin_id = seeded["admin"]["id"]

    # 试图自吊销
    self_rev = client.post(f"/api/keys/{admin_id}/revoke", headers=headers)
    assert_failure(self_rev, 422, VALIDATION_ERROR)
    assert "禁止对当前正在使用的管理凭据执行吊销或删除操作" in self_rev.json()["error"]["message"]

    # 试图自删除
    self_del = client.delete(f"/api/keys/{admin_id}", headers=headers)
    assert_failure(self_del, 422, VALIDATION_ERROR)
    assert "禁止对当前正在使用的管理凭据执行吊销或删除操作" in self_del.json()["error"]["message"]

    # 试图吊销或删除 admin 虚拟凭据
    adm_rev = client.post("/api/keys/admin/revoke", headers=headers)
    assert_failure(adm_rev, 422, VALIDATION_ERROR)
    assert "环境变量管理员凭据不受管理接口支持" in adm_rev.json()["error"]["message"]

    adm_del = client.delete("/api/keys/admin", headers=headers)
    assert_failure(adm_del, 422, VALIDATION_ERROR)
    assert "环境变量管理员凭据不受管理接口支持" in adm_del.json()["error"]["message"]


def test_orphaned_scope_behavior_on_group_delete(client, seeded, conn):
    headers = web_headers(seeded["admin"]["token"])
    # 1. 创建空分类
    client.post("/api/groups", headers=headers, json={"slug": "orphaned_test", "name": "悬空测试"})
    # 2. 签发该分类权限 Key
    created = client.post(
        "/api/keys",
        headers=headers,
        json={"name": "悬空Key", "scopes": {"orphaned_test": "rw"}},
    ).json()["data"]
    key_id = created["id"]

    # 3. 删除分类
    del_grp = client.delete("/api/groups/orphaned_test", headers=headers)
    assert del_grp.status_code == 200

    # 4. 验证 Key 中的 scopes 保持原样
    key_row = dal.get_key(conn, key_id)
    assert key_row["scopes"] == {"orphaned_test": "rw"}

    # 5. 重建同名分类
    client.post("/api/groups", headers=headers, json={"slug": "orphaned_test", "name": "重建分组"})

    # 6. 该 Key 重新获得有效权限
    reopened = db.connect()
    try:
        grps = dal.list_groups_with_counts(reopened, key_row["scopes"])
        assert any(g["slug"] == "orphaned_test" and g["permission"] == "rw" for g in grps)
    finally:
        reopened.close()


def test_non_admin_token_rejected_on_all_new_endpoints(client, seeded):
    headers = web_headers(seeded["proj"]["token"])
    assert_failure(client.delete("/api/groups/proj", headers=headers), 403, FORBIDDEN)
    assert_failure(client.get("/api/keys", headers=headers), 403, FORBIDDEN)
    assert_failure(
        client.post("/api/keys", headers=headers, json={"name": "x", "scopes": {"proj": "r"}}),
        403,
        FORBIDDEN,
    )
    assert_failure(client.post("/api/keys/some_id/revoke", headers=headers), 403, FORBIDDEN)
    assert_failure(client.delete("/api/keys/some_id", headers=headers), 403, FORBIDDEN)

