"""Six Phase 1 acceptance assertions, one test module per assertion."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from capsa import dal, db, retrieval
from capsa.server import MAX_REQUEST_BYTES, app
from tests.conftest import (
    MARCH,
    PROJ_MEMORY,
    STUDY_MEMORY,
    auth_headers,
    insert_memory,
    parse_body,
)


# 用例一：依赖安装与启动 —— /healthz 无认证返回 200
def test_healthz_ok(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# 用例一（续）：数据库不可用时返回 503
def test_healthz_database_unavailable(bare_client, monkeypatch):
    monkeypatch.setattr("capsa.server.check_db_health", lambda: False)
    response = bare_client.get("/healthz")
    assert response.status_code == 503
    assert response.json() == {"status": "error", "message": "database unavailable"}


# 用例二：1MB 拦截
def test_oversized_body_rejected(client):
    response = client.post("/mcp", content=b"x" * 1_100_000, headers=auth_headers("cap_invalid"))
    assert response.status_code == 413


def test_exact_limit_not_rejected(client):
    response = client.post("/mcp", content=b"x" * MAX_REQUEST_BYTES, headers=auth_headers("cap_invalid"))
    assert response.status_code == 401


def test_chunked_body_over_limit_rejected(client, open_session, seeded):
    """无 content-length 的分块传输在真实链路上累计超限并返回 413。

    必须携带有效会话：无效令牌在鉴权层即被拒，请求体根本不会被读取，
    走的不是分块累计分支。
    """
    session = open_session(seeded["proj"]["token"])

    def body():
        for _ in range(3):
            yield b"x" * 500_000

    response = client.post("/mcp", content=body(), headers=session.headers)
    assert response.status_code == 413


# 用例三：鉴权与撤销
def test_invalid_token_rejected(client, initialize):
    assert initialize(client, "capsa_invalid_token").status_code == 401


def test_revoked_key_rejected(client, initialize, seeded):
    assert initialize(client, seeded["proj"]["token"]).status_code == 200
    connection = db.connect()
    try:
        assert dal.revoke_key(connection, seeded["proj"]["id"]) is True
    finally:
        connection.close()
    assert initialize(client, seeded["proj"]["token"]).status_code == 401


# 用例四：三态防线隔离
FORBIDDEN_SECRETS = ("study", "OAuth 笔记", "摘要中的授权流程", "正文中的授权细节")


@pytest.mark.parametrize("tool", ["memory_peek", "memory_read"])
def test_forbidden_entries_leak_nothing(open_session, seeded, tool):
    text = open_session(seeded["proj"]["token"]).text(tool, {"ids": [STUDY_MEMORY]})
    assert f"[1] {STUDY_MEMORY} | [无权访问]" in text
    for secret in FORBIDDEN_SECRETS:
        assert secret not in text


def test_search_never_carries_unauthorized_entries(open_session, seeded):
    """L1 的防线是条目根本不进入候选集，而非渲染成 [无权访问]。"""
    text = open_session(seeded["proj"]["token"]).text("memory_search", {"query": "授权"})
    assert STUDY_MEMORY not in text
    assert "[无权访问]" not in text
    for secret in FORBIDDEN_SECRETS:
        assert secret not in text


def test_dal_forbidden_payload_has_only_status_and_id(conn, seeded):
    result = dal.get_memories_batch_for_access(conn, [STUDY_MEMORY], {"proj": "rw"})
    assert result == [{"status": "forbidden", "id": STUDY_MEMORY}]


# 用例五：打分与排序确定性
def test_chinese_bigram_query_hits_expected_entry(open_session, seeded):
    text = open_session(seeded["proj"]["token"]).text("memory_search", {"query": "密钥轮换"})
    assert PROJ_MEMORY in text
    assert STUDY_MEMORY not in text


def test_empty_query_browses_by_pinned_then_updated(conn, seeded):
    insert_memory(
        conn,
        "mem_pin001",
        "proj",
        "置顶的旧条目",
        pinned=1,
        updated_at="2025-01-01T00:00:00+00:00",
    )
    memories = dal.list_active_memories_for_search(conn, {"proj": "rw"})
    ranked = retrieval.rank_memories(memories, "")
    assert [memory["id"] for memory in ranked] == ["mem_pin001", PROJ_MEMORY]


def test_same_updated_at_falls_back_to_id_descending():
    memories = [
        {"id": "mem_000001", "title": "a", "summary": "", "tags": "[]", "review_at": None,
         "pinned": 0, "updated_at": MARCH},
        {"id": "mem_000002", "title": "a", "summary": "", "tags": "[]", "review_at": None,
         "pinned": 0, "updated_at": MARCH},
    ]
    ranked = retrieval.rank_memories(memories, "")
    assert [memory["id"] for memory in ranked] == ["mem_000002", "mem_000001"]
    assert [memory["id"] for memory in memories] == ["mem_000001", "mem_000002"]


def test_offset_aware_timestamps_rank_equally():
    common = {"title": "a", "summary": "", "tags": "[]", "review_at": None, "pinned": 0}
    memories = [
        {**common, "id": "mem_000001", "updated_at": "2026-03-11T08:00:00+00:00"},
        {**common, "id": "mem_000002", "updated_at": "2026-03-11T16:00:00+08:00"},
    ]
    first = retrieval.rank_memories(memories, "")
    second = retrieval.rank_memories(list(reversed(memories)), "")
    assert [memory["id"] for memory in first] == [memory["id"] for memory in second]


def test_pinned_scores_exactly_three_higher():
    base = {"title": "标题", "summary": "摘要", "tags": "[]", "review_at": None,
            "updated_at": MARCH}
    terms = retrieval.tokenize("标题")
    assert retrieval.score({**base, "pinned": 1}, terms) - retrieval.score(
        {**base, "pinned": 0}, terms
    ) == 3


def test_expired_review_scores_exactly_two_lower():
    base = {"title": "标题", "summary": "摘要", "tags": "[]", "pinned": 0, "updated_at": MARCH}
    terms = retrieval.tokenize("标题")
    expired = retrieval.score(
        {**base, "review_at": "2000-01-01T00:00:00+00:00"},
        terms,
        datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    live = retrieval.score(
        {**base, "review_at": "2030-01-01T00:00:00+00:00"},
        terms,
        datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    assert live - expired == 2


# 用例六：体积截断与续读
def test_long_body_is_truncated_with_continuation(open_session, conn, seeded):
    body = "正" * 5000
    insert_memory(conn, "mem_long01", "proj", "长文", body=body)
    session = open_session(seeded["proj"]["token"])
    text = session.text("memory_read", {"ids": ["mem_long01"]})
    assert "正" * 4000 in text
    assert "正" * 4001 not in text
    assert '[截断: 本条剩余 1000 字符未返回]' in text
    assert '> 续读: memory_read(ids=["mem_long01"], offset=4000)' in text

    remainder = session.text("memory_read", {"ids": ["mem_long01"], "offset": 4000})
    assert "正" * 1000 in remainder
    assert "正" * 1001 not in remainder
    assert "> 续读:" not in remainder


def test_response_budget_stops_by_id_order():
    """5 条 × 4000 恰好等于 20000 的额度，因此用 6 条在格式层验证停止点。"""
    from capsa import formatters

    body = "甲" * 5000
    items = [
        {
            "status": "authorized",
            "id": f"mem_bulk{i:02d}",
            "group_slug": "proj",
            "title": f"第{i}篇",
            "summary": "摘要",
            "body": body,
            "tags": "[]",
            "review_at": None,
            "pinned": 0,
            "created_at": MARCH,
            "updated_at": MARCH,
        }
        for i in range(1, 7)
    ]
    text = formatters.format_read(items)
    assert "===== mem_bulk01" in text
    assert "===== mem_bulk05" in text
    assert "===== mem_bulk06" not in text
    assert "第6篇" not in text
    assert text.count("甲") == formatters.MAX_RESPONSE_CHARS
    expected_ids = json.dumps([f"mem_bulk{i:02d}" for i in range(1, 6)])
    assert f"> 续读: memory_read(ids={expected_ids}, offset=4000)" in text


def test_pinned_entry_without_term_hit_is_not_recalled(open_session, conn, seeded):
    insert_memory(conn, "mem_pin999", "proj", "完全不相关的置顶条目", pinned=1)
    text = open_session(seeded["proj"]["token"]).text("memory_search", {"query": "密钥轮换"})
    assert PROJ_MEMORY in text
    assert "mem_pin999" not in text
    assert "命中 1 条" in text


def test_search_limit_below_one_is_rejected(open_session, seeded):
    result = open_session(seeded["proj"]["token"]).call("memory_search", {"limit": 0})
    assert result["isError"] is True
    assert "1~20" in result["content"][0]["text"]


def test_read_rejects_more_than_five_ids(open_session, seeded):
    result = open_session(seeded["proj"]["token"]).call(
        "memory_read", {"ids": [f"mem_x{i:05d}" for i in range(6)]}
    )
    assert result["isError"] is True
    assert "ids 上限为 5" in result["content"][0]["text"]


def test_negative_offset_is_clamped_to_zero(open_session, seeded):
    text = open_session(seeded["proj"]["token"]).text(
        "memory_read", {"ids": [PROJ_MEMORY], "offset": -5}
    )
    assert "正文里的机密内容" in text


def test_offset_past_end_reports_termination(open_session, seeded):
    text = open_session(seeded["proj"]["token"]).text(
        "memory_read", {"ids": [PROJ_MEMORY], "offset": 999}
    )
    assert "（正文已到结尾，无更多内容）" in text


# 无标签条目的标签字段
def test_memory_without_tags_renders_dash(open_session, seeded):
    text = open_session(seeded["proj"]["token"]).text("memory_search", {})
    assert "标签: -" in text
