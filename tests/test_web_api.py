"""Web API contracts: envelope, error mapping and authorization symmetry."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

import pytest

from capsa import dal, db, retrieval
from capsa.mcp_service import SUMMARY_MAX, TITLE_MAX
from capsa.web_api import (
    FORBIDDEN,
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
    headers = web_headers(seeded["proj"]["token"])
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    conn = db.connect()
    try:
        assert dal.revoke_key(conn, seeded["proj"]["id"]) is True
    finally:
        conn.close()
    assert_failure(client.get("/api/auth/me", headers=headers), 401, UNAUTHORIZED)


def test_auth_me_returns_the_issued_scopes(client, seeded):
    response = client.get("/api/auth/me", headers=web_headers(seeded["proj"]["token"]))
    assert response.status_code == 200
    body = response.json()
    assert set(body) == ENVELOPE_KEYS
    assert body["error"] is None
    assert body["data"] == {"key_id": seeded["proj"]["id"], "name": "proj-key", "scopes": {"proj": "rw"}}


def test_groups_lists_only_authorized_groups(client, seeded):
    response = client.get("/api/groups", headers=web_headers(seeded["proj"]["token"]))
    assert response.status_code == 200
    data = response.json()["data"]
    assert set(data) == LIST_META_KEYS
    assert data["total"] == 1
    assert data["offset"] == 0
    assert data["limit"] == 1
    assert data["items"] == [
        {
            "slug": "proj",
            "name": "项目",
            "description": "项目记忆",
            "count": 1,
            "permission": "rw",
        }
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
            local.get("/api/groups", headers=web_headers(seeded["proj"]["token"])), 500, INTERNAL_ERROR
        )
    assert body["error"]["message"] == "服务内部错误"
    assert "RuntimeError" not in json.dumps(body, ensure_ascii=False)
    assert "内部堆栈细节" not in json.dumps(body, ensure_ascii=False)


# --- TASK-035 记忆列表与详情 ---


def test_memories_list_envelope_and_item_contract(client, seeded):
    response = client.get("/api/memories", headers=web_headers(seeded["proj"]["token"]))
    assert response.status_code == 200
    body = response.json()
    assert set(body) == ENVELOPE_KEYS
    assert body["error"] is None
    data = body["data"]
    assert set(data) == LIST_META_KEYS
    assert (data["total"], data["offset"], data["limit"]) == (1, 0, 20)
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
        headers=web_headers(seeded["proj"]["token"]),
        params={"query": "模型架构"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["total"] == 0

    insert_memory(conn := db.connect(), "mem_bigram", "proj", "MCP 授权模型与设计架构")
    conn.close()
    response = client.get(
        "/api/memories",
        headers=web_headers(seeded["proj"]["token"]),
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
    headers = web_headers(seeded["proj"]["token"])
    page = client.get("/api/memories", headers=headers, params={"limit": 1, "offset": 1}).json()["data"]
    everything = client.get("/api/memories", headers=headers, params={"limit": 100}).json()["data"]
    assert page["total"] == everything["total"] == 2
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
    headers = web_headers(seeded["proj"]["token"])
    overdue = client.get("/api/memories", headers=headers, params={"status": "overdue"}).json()["data"]
    assert [item["id"] for item in overdue["items"]] == ["mem_over"]
    deleted = client.get("/api/memories", headers=headers, params={"status": "deleted"}).json()["data"]
    assert [item["id"] for item in deleted["items"]] == ["mem_live"]
    assert deleted["items"][0]["deleted_reason"] == "归档"
    assert deleted["items"][0]["is_overdue"] is False


def test_readonly_key_never_sees_unauthorized_deleted_entries(client, seeded):
    conn = db.connect()
    try:
        reader = create_key(conn, "proj-reader", {"proj": "r"})
        conn.execute(
            "UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?",
            (db.utcnow(), "学习归档", STUDY_MEMORY),
        )
        conn.commit()
    finally:
        conn.close()
    response = client.get(
        "/api/memories", headers=web_headers(reader["token"]), params={"status": "deleted"}
    )
    data = response.json()["data"]
    assert data["total"] == 0
    assert data["items"] == []
    assert "学习归档" not in response.text
    assert STUDY_MEMORY not in response.text


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
    response = client.get("/api/memories", headers=web_headers(seeded["proj"]["token"]), params=params)
    assert_failure(response, 422, VALIDATION_ERROR)


def test_api_prefix_is_never_hijacked_by_static_mount(client, seeded):
    response = client.get("/api/memories", headers=web_headers(seeded["proj"]["token"]))
    assert response.headers["content-type"].startswith("application/json")


def test_memory_detail_returns_the_full_body(client, seeded, conn):
    body = "甲" * 6000
    insert_memory(conn, "mem_long", "proj", "长文", body=body)
    response = client.get("/api/memories/mem_long", headers=web_headers(seeded["proj"]["token"]))
    assert response.status_code == 200
    data = response.json()["data"]
    assert set(data) == set(dal.WEB_ITEM_FIELDS) | ITEM_EXTRA
    assert data["body"] == body
    assert data["is_overdue"] is False


def test_detail_unauthorized_and_missing_ids_are_indistinguishable(client, seeded):
    headers = web_headers(seeded["proj"]["token"])
    unauthorized = client.get(f"/api/memories/{STUDY_MEMORY}", headers=headers)
    missing = client.get("/api/memories/mem_zzz999", headers=headers)
    assert_failure(unauthorized, 404, NOT_FOUND)
    assert unauthorized.json() == missing.json()
    assert STUDY_MEMORY not in unauthorized.text
    assert "OAuth 笔记" not in unauthorized.text
    assert "正文中的授权细节" not in unauthorized.text


def test_detail_hides_soft_deleted_entries(client, seeded, conn):
    conn.execute(
        "UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?",
        (db.utcnow(), "归档", PROJ_MEMORY),
    )
    conn.commit()
    response = client.get(f"/api/memories/{PROJ_MEMORY}", headers=web_headers(seeded["proj"]["token"]))
    assert_failure(response, 404, NOT_FOUND)


# --- TASK-036 写入端点 ---


def test_create_returns_an_id_readable_through_detail(client, seeded):
    response = create(client, seeded["proj"]["token"], title="可读回", tags=["a", "b"])
    assert response.status_code == 200
    data = response.json()["data"]
    assert re.fullmatch(r"mem_[a-z0-9]{6}", data["id"])
    assert data["similar_items"] == []
    detail = client.get(f"/api/memories/{data['id']}", headers=web_headers(seeded["proj"]["token"]))
    assert detail.json()["data"]["title"] == "可读回"
    assert detail.json()["data"]["tags"] == ["a", "b"]


def test_create_forbidden_shares_one_message_for_both_cases(client, seeded, conn):
    reader = create_key(conn, "proj-reader", {"proj": "r"})
    before = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
    readonly = create(client, reader["token"], group="proj")
    invisible = create(client, reader["token"], group="study")
    assert_failure(readonly, 403, FORBIDDEN)
    assert_failure(invisible, 403, FORBIDDEN)
    # 两种拒绝共用一条模板，只回显调用方自己传入的分组名。
    assert readonly.json()["error"]["message"] == "对分组 proj 没有写权限，拒绝写入"
    assert invisible.json()["error"]["message"] == "对分组 study 没有写权限，拒绝写入"
    assert conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == before


def test_create_over_limit_matches_the_mcp_message(client, seeded, open_session):
    session = open_session(seeded["proj"]["token"])
    mcp = session.call(
        "memory_save",
        {"group": "proj", "title": "标" * (TITLE_MAX + 1), "summary": "摘要", "body": "正文"},
    )
    web = create(client, seeded["proj"]["token"], title="标" * (TITLE_MAX + 1))
    assert_failure(web, 422, VALIDATION_ERROR)
    assert web.json()["error"]["message"] == mcp["content"][0]["text"]


def test_create_reports_similar_items_but_still_stores(client, seeded, conn):
    first = create(client, seeded["proj"]["token"], title="记忆分组表").json()["data"]["id"]
    response = create(client, seeded["proj"]["token"], title="记忆分组")
    assert response.status_code == 200
    similar = response.json()["data"]["similar_items"]
    assert [item["id"] for item in similar] == [first]
    assert set(similar[0]) == {"id", "title", "similarity"}
    assert similar[0]["similarity"] == pytest.approx(0.75)
    assert conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 4


def test_update_touches_only_the_given_fields(client, seeded):
    headers = web_headers(seeded["proj"]["token"])
    before = client.get(f"/api/memories/{PROJ_MEMORY}", headers=headers).json()["data"]
    response = client.put(f"/api/memories/{PROJ_MEMORY}", headers=headers, json={"title": "改名"})
    assert response.status_code == 200
    assert response.json()["data"] == {"id": PROJ_MEMORY, "action": "updated"}
    after = client.get(f"/api/memories/{PROJ_MEMORY}", headers=headers).json()["data"]
    assert after["title"] == "改名"
    for field in ("summary", "body", "tags", "review_at", "pinned", "created_at", "group_slug"):
        assert after[field] == before[field]


def test_update_clears_and_sets_review_at(client, seeded):
    headers = web_headers(seeded["proj"]["token"])
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
        f"/api/memories/{PROJ_MEMORY}", headers=web_headers(seeded["proj"]["token"]), json=payload
    )
    assert_failure(response, 422, VALIDATION_ERROR)


def test_put_on_readonly_or_foreign_or_missing_is_opaque(client, conn, seeded):
    headers = web_headers(seeded["study"]["token"])
    readonly = create_key(conn, "proj-reader", {"proj": "r"})
    denied = client.put(
        f"/api/memories/{PROJ_MEMORY}", headers=web_headers(readonly["token"]), json={"title": "x"}
    )
    assert_failure(denied, 403, FORBIDDEN)
    assert "只读权限" in denied.json()["error"]["message"]
    foreign = client.put(f"/api/memories/{PROJ_MEMORY}", headers=headers, json={"title": "x"})
    missing = client.put("/api/memories/mem_zzz999", headers=headers, json={"title": "x"})
    assert_failure(foreign, 404, NOT_FOUND)
    assert foreign.json() == missing.json()


def test_delete_moves_the_entry_to_the_recycle_bin(client, seeded):
    headers = web_headers(seeded["proj"]["token"])
    response = client.request(
        "DELETE", f"/api/memories/{PROJ_MEMORY}", headers=headers, json={"reason": "不再需要"}
    )
    assert response.status_code == 200
    assert response.json()["data"] == {"id": PROJ_MEMORY, "action": "deleted"}
    active = client.get("/api/memories", headers=headers).json()["data"]
    assert active["items"] == []
    deleted = client.get("/api/memories", headers=headers, params={"status": "deleted"}).json()["data"]
    assert [item["id"] for item in deleted["items"]] == [PROJ_MEMORY]
    assert deleted["items"][0]["deleted_reason"] == "不再需要"
    assert deleted["items"][0]["deleted_at"] is not None


@pytest.mark.parametrize("reason", ["", "   "])
def test_delete_requires_a_reason(client, seeded, conn, reason):
    response = client.request(
        "DELETE", f"/api/memories/{PROJ_MEMORY}", headers=web_headers(seeded["proj"]["token"]), json={"reason": reason}
    )
    assert_failure(response, 422, VALIDATION_ERROR)
    assert response.json()["error"]["message"] == "删除原因不能为空"
    assert conn.execute("SELECT deleted_at FROM memories WHERE id = ?", (PROJ_MEMORY,)).fetchone()[0] is None


def test_restore_returns_the_entry_to_the_workbench(client, seeded):
    headers = web_headers(seeded["proj"]["token"])
    client.request("DELETE", f"/api/memories/{PROJ_MEMORY}", headers=headers, json={"reason": "误删"})
    response = client.post(f"/api/memories/{PROJ_MEMORY}/restore", headers=headers)
    assert response.status_code == 200
    assert response.json()["data"] == {"id": PROJ_MEMORY, "action": "restored"}
    active = client.get("/api/memories", headers=headers).json()["data"]
    assert [item["id"] for item in active["items"]] == [PROJ_MEMORY]
    deleted = client.get("/api/memories", headers=headers, params={"status": "deleted"}).json()["data"]
    assert deleted["items"] == []


def test_restore_rejects_live_entries_and_readonly_keys(client, seeded, conn):
    headers = web_headers(seeded["proj"]["token"])
    assert_failure(client.post(f"/api/memories/{PROJ_MEMORY}/restore", headers=headers), 404, NOT_FOUND)
    reader = create_key(conn, "proj-reader", {"proj": "r"})
    conn.execute(
        "UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?",
        (db.utcnow(), "误删", PROJ_MEMORY),
    )
    conn.commit()
    denied = client.post(f"/api/memories/{PROJ_MEMORY}/restore", headers=web_headers(reader["token"]))
    assert_failure(denied, 403, FORBIDDEN)
    assert "只读权限" in denied.json()["error"]["message"]


def test_oversized_body_is_rejected_on_the_api_prefix(client, seeded):
    response = client.post(
        "/api/memories",
        headers=web_headers(seeded["proj"]["token"]),
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
