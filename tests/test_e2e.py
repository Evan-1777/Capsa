"""End-to-end read-only chain and service assembly acceptance."""

from __future__ import annotations

import json
import re

from capsa import dal, db, retrieval
from tests.conftest import PROJ_MEMORY, STUDY_MEMORY, auth_headers
from tests.test_acceptance import FORBIDDEN_SECRETS

NEXT_STEP = re.compile(r"> 下一步: memory_\w+\(ids=(\[[^\]]*\])")


def next_ids(text: str) -> list[str]:
    match = NEXT_STEP.search(text)
    assert match, text
    return json.loads(match.group(1))


def test_tools_list_exposes_seven_tools(open_session, seeded):
    tools = open_session(seeded["proj"]["token"]).list_tools()
    assert [tool["name"] for tool in tools] == [
        "memory_groups",
        "memory_search",
        "memory_peek",
        "memory_read",
        "memory_save",
        "memory_update",
        "memory_forget",
    ]
    annotations = {tool["name"]: tool["annotations"] for tool in tools}
    for name in ("memory_groups", "memory_search", "memory_peek", "memory_read"):
        assert annotations[name]["readOnlyHint"] is True, name
    assert annotations["memory_save"]["destructiveHint"] is False
    assert annotations["memory_update"]["idempotentHint"] is True
    assert annotations["memory_forget"]["destructiveHint"] is True


def test_read_chain_is_wired_end_to_end(open_session, seeded):
    session = open_session(seeded["proj"]["token"])
    groups = session.text("memory_groups")
    assert "proj" in groups
    assert "study" not in groups

    search = session.text("memory_search", {})
    assert PROJ_MEMORY in search
    peek_ids = next_ids(search)
    assert peek_ids == [PROJ_MEMORY]

    peek = session.text("memory_peek", {"ids": peek_ids})
    assert "标题: 项目密钥轮换方案" in peek
    assert "摘要: 摘要里的敏感实现细节" in peek
    read_ids = next_ids(peek)
    assert read_ids == peek_ids

    read = session.text("memory_read", {"ids": read_ids})
    assert "正文里的机密内容" in read
    assert "> 下一步:" not in read


def test_two_keys_see_disjoint_groups(open_session, seeded):
    proj_session = open_session(seeded["proj"]["token"])
    study_session = open_session(seeded["study"]["token"])

    proj_text = proj_session.text("memory_groups")
    study_text = study_session.text("memory_groups")
    assert "proj" in proj_text and "study" not in proj_text
    assert "study" in study_text and "proj" not in study_text

    assert PROJ_MEMORY in proj_session.text("memory_search", {})
    assert STUDY_MEMORY not in proj_session.text("memory_search", {})
    assert STUDY_MEMORY in study_session.text("memory_search", {})

    for secret in FORBIDDEN_SECRETS:
        assert secret not in proj_session.text("memory_search", {})
        assert secret not in proj_session.text("memory_peek", {"ids": [STUDY_MEMORY]})


def test_read_chain_reaches_the_end_of_a_long_body(open_session, conn, seeded):
    from tests.conftest import insert_memory

    insert_memory(conn, "mem_long99", "proj", "长文", body="正" * 4500)
    session = open_session(seeded["proj"]["token"])

    first = session.text("memory_read", {"ids": ["mem_long99"]})
    assert first.count("正") == 4000
    match = re.search(r"offset=(\d+)\)", first)
    assert match, first

    rest = session.text("memory_read", {"ids": ["mem_long99"], "offset": int(match.group(1))})
    assert rest.count("正") == 500
    assert "> 续读:" not in rest


def test_tool_chain_order_matches_rank_memories(open_session, conn, seeded):
    from tests.conftest import insert_memory

    insert_memory(conn, "mem_pin002", "proj", "置顶条目", pinned=1, updated_at="2025-06-01T00:00:00+00:00")
    insert_memory(conn, "mem_new003", "proj", "较新条目", updated_at="2026-06-01T00:00:00+00:00")

    text = open_session(seeded["proj"]["token"]).text("memory_search", {})
    rendered = next_ids(text)
    expected = [
        memory["id"]
        for memory in retrieval.rank_memories(
            dal.list_active_memories_for_search(conn, {"proj": "rw"}), ""
        )
    ]
    assert rendered == expected


def test_mcp_endpoint_serves_bare_path_without_redirect(bare_client):
    """裸 /mcp 必须直达鉴权层；307 跳转会让只跟随同源重定向的客户端丢失方法体。"""
    response = bare_client.post(
        "/mcp", headers=auth_headers("capsa_invalid"), json={}, follow_redirects=False
    )
    assert response.status_code == 401


def test_startup_creates_no_implicit_data(bare_client, initialize, conn):
    assert bare_client.get("/healthz").status_code == 200
    assert initialize(bare_client, None).status_code == 401
    assert conn.execute("SELECT COUNT(*) FROM groups").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM keys").fetchone()[0] == 0


def test_full_handshake_adds_no_data(conn, seeded, open_session):
    assert open_session(seeded["proj"]["token"]).text("memory_groups")
    assert conn.execute("SELECT COUNT(*) FROM groups").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM keys").fetchone()[0] == 3


def test_revoked_key_loses_tool_access(client, initialize, open_session, seeded):
    session = open_session(seeded["proj"]["token"])
    assert session.text("memory_groups")
    connection = db.connect()
    try:
        dal.revoke_key(connection, seeded["proj"]["id"])
    finally:
        connection.close()
    assert initialize(client, seeded["proj"]["token"]).status_code == 401
