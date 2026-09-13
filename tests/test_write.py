"""Phase 2 write contracts: field limits, dedup hints, lifecycle and permission tiers."""

from __future__ import annotations

import json
import re
import sqlite3

import pytest

from capsa import dal, db, retrieval
from capsa.mcp_service import BODY_MAX, SUMMARY_MAX, TITLE_MAX
from tests.conftest import PROJ_MEMORY, STUDY_MEMORY, create_key, insert_memory
from tests.test_cli import run_cli

TITLE_SAMPLE = "记忆分组"
REVIEW_PAST = "2000-01-01T00:00:00+00:00"


def row_count(conn) -> int:
    return conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]


def save(session, **overrides) -> dict:
    payload = {
        "group": "proj",
        "title": "新条目",
        "summary": "摘要",
        "body": "正文",
        **overrides,
    }
    return session.call("memory_save", payload)


# --- TASK-021 契约函数 ---


def test_normalize_review_at_converges_offsets():
    assert retrieval.normalize_review_at("2026-10-01T09:30:00+08:00") == retrieval.normalize_review_at(
        "2026-10-01T01:30:00+00:00"
    )
    assert retrieval.normalize_review_at("2026-10-01")[:10] == "2026-10-01"
    with pytest.raises(ValueError):
        retrieval.normalize_review_at("下周三")


def test_title_similarity_samples():
    assert retrieval.title_similarity("记忆分组", "记忆分组表") == pytest.approx(0.75)
    assert retrieval.title_similarity("授权模型", "授权模型定稿") == pytest.approx(
        retrieval.SIMILARITY_THRESHOLD
    )
    assert retrieval.title_similarity("OAuth", "OAuth") == 1.0
    assert retrieval.title_similarity("!!!", "???") == 0.0


def test_find_similar_memories_filters_and_orders():
    candidates = [
        {"id": "mem_low", "title": "记忆分组"},
        {"id": "mem_high", "title": "记忆分组表"},
        {"id": "mem_none", "title": "无关内容"},
    ]
    found = retrieval.find_similar_memories(candidates, "记忆分组表")
    assert [item["id"] for item in found] == ["mem_high", "mem_low"]
    assert [item["similarity"] for item in found] == [1.0, 0.75]


# --- TASK-028 字段硬契约与查重 ---


def test_title_at_limit_is_accepted(open_session, seeded, conn):
    response = save(open_session(seeded["proj"]["token"]), title="标" * TITLE_MAX)
    assert response.get("isError") is not True
    assert row_count(conn) == 3


def test_title_over_limit_is_rejected(open_session, seeded, conn):
    response = save(open_session(seeded["proj"]["token"]), title="标" * (TITLE_MAX + 1))
    assert response["isError"] is True
    assert f"当前 {TITLE_MAX + 1} 字符" in response["content"][0]["text"]
    assert f"上限 {TITLE_MAX} 字符" in response["content"][0]["text"]
    assert row_count(conn) == 2


def test_summary_at_limit_is_accepted(open_session, seeded):
    response = save(open_session(seeded["proj"]["token"]), summary="要" * SUMMARY_MAX)
    assert response.get("isError") is not True


def test_summary_over_limit_is_rejected(open_session, seeded, conn):
    response = save(open_session(seeded["proj"]["token"]), summary="要" * (SUMMARY_MAX + 1))
    assert response["isError"] is True
    assert f"当前 {SUMMARY_MAX + 1} 字符" in response["content"][0]["text"]
    assert f"上限 {SUMMARY_MAX} 字符" in response["content"][0]["text"]
    assert row_count(conn) == 2


def test_body_at_limit_is_accepted(open_session, seeded):
    response = save(open_session(seeded["proj"]["token"]), body="文" * BODY_MAX)
    assert response.get("isError") is not True


def test_body_over_limit_is_rejected(open_session, seeded, conn):
    response = save(open_session(seeded["proj"]["token"]), body="文" * (BODY_MAX + 1))
    assert response["isError"] is True
    assert f"当前 {BODY_MAX + 1} 字符" in response["content"][0]["text"]
    assert f"上限 {BODY_MAX} 字符" in response["content"][0]["text"]
    assert row_count(conn) == 2


@pytest.mark.parametrize("title", ["", "   "])
def test_empty_title_is_rejected(open_session, seeded, title):
    response = save(open_session(seeded["proj"]["token"]), title=title)
    assert response["isError"] is True
    assert "标题不能为空" in response["content"][0]["text"]


def test_invalid_review_at_is_rejected(open_session, seeded):
    response = save(open_session(seeded["proj"]["token"]), review_at="下周三")
    assert response["isError"] is True
    assert "ISO 8601" in response["content"][0]["text"]


def test_review_at_is_stored_as_utc(open_session, seeded, conn):
    response = save(open_session(seeded["proj"]["token"]), review_at="2026-10-01T09:30:00+08:00")
    assert response.get("isError") is not True
    memory_id = response["content"][0]["text"].split("已新建记忆：")[1].split(" ")[0]
    stored = conn.execute("SELECT review_at FROM memories WHERE id = ?", (memory_id,)).fetchone()
    assert stored["review_at"] == "2026-10-01T01:30:00+00:00"


def test_similar_title_is_saved_with_hint(open_session, seeded, conn):
    response = save(open_session(seeded["proj"]["token"]), title="项目密钥轮换方案")
    assert response.get("isError") is not True
    text = response["content"][0]["text"]
    assert row_count(conn) == 3
    assert PROJ_MEMORY in text
    assert f"{PROJ_MEMORY} | 相似度 1.0" in text
    assert "已照常创建" in text


def test_save_into_missing_group_reports_tool_error(open_session, conn):
    key = create_key(conn, "ghost", {"ghost": "rw"})
    response = save(open_session(key["token"]), group="ghost")
    assert response["isError"] is True
    assert "分组 ghost 不存在" in response["content"][0]["text"]


# --- TASK-029 生命周期与权限分级 ---


def test_partial_update_keeps_untouched_fields(open_session, seeded, conn):
    insert_memory(
        conn,
        "mem_upd001",
        "proj",
        "原标题",
        "原摘要",
        "原正文",
        tags='["keep"]',
        review_at="2030-01-01T00:00:00+00:00",
        pinned=1,
    )
    before = dict(
        conn.execute(
            "SELECT title, summary, body, tags, review_at, pinned, created_at FROM memories"
            " WHERE id = ?",
            ("mem_upd001",),
        ).fetchone()
    )
    response = open_session(seeded["proj"]["token"]).call(
        "memory_update", {"id": "mem_upd001", "summary": "新摘要"}
    )
    assert response.get("isError") is not True
    after = dict(
        conn.execute(
            "SELECT title, summary, body, tags, review_at, pinned, created_at, updated_at"
            " FROM memories WHERE id = ?",
            ("mem_upd001",),
        ).fetchone()
    )
    assert after["summary"] == "新摘要"
    assert after["title"] == before["title"] == "原标题"
    assert after["body"] == before["body"] == "原正文"
    assert after["tags"] == before["tags"] == '["keep"]'
    assert after["review_at"] == before["review_at"]
    assert after["pinned"] == before["pinned"] == 1
    assert after["created_at"] == before["created_at"]


def test_empty_tags_render_as_dash(open_session, seeded, conn):
    insert_memory(conn, "mem_upd002", "proj", "带标签", tags='["a","b"]')
    session = open_session(seeded["proj"]["token"])
    assert "标签: a,b" in session.text("memory_search", {})
    assert session.call("memory_update", {"id": "mem_upd002", "tags": []}).get("isError") is not True
    assert "标签: -" in session.text("memory_search", {})


def test_clear_review_at_removes_expiry(open_session, seeded, conn):
    insert_memory(conn, "mem_upd003", "proj", "过期条目", review_at=REVIEW_PAST)
    session = open_session(seeded["proj"]["token"])
    assert "（复核已过期）" in session.text("memory_search", {})
    assert session.call("memory_update", {"id": "mem_upd003", "clear_review_at": True}).get(
        "isError"
    ) is not True
    assert conn.execute(
        "SELECT review_at FROM memories WHERE id = ?", ("mem_upd003",)
    ).fetchone()["review_at"] is None
    assert "（复核已过期）" not in session.text("memory_search", {})


def test_clear_review_at_conflicts_with_review_at(open_session, seeded):
    response = open_session(seeded["proj"]["token"]).call(
        "memory_update",
        {"id": PROJ_MEMORY, "review_at": "2030-01-01T00:00:00+00:00", "clear_review_at": True},
    )
    assert response["isError"] is True
    assert "不能同时给出" in response["content"][0]["text"]


def test_update_without_fields_is_rejected(open_session, seeded):
    response = open_session(seeded["proj"]["token"]).call("memory_update", {"id": PROJ_MEMORY})
    assert response["isError"] is True
    assert "至少提供一个待更新字段" in response["content"][0]["text"]


def test_update_unknown_field_is_rejected(open_session, seeded, conn):
    before = conn.execute("SELECT updated_at FROM memories WHERE id = ?", (PROJ_MEMORY,)).fetchone()
    response = open_session(seeded["proj"]["token"]).call(
        "memory_update", {"id": PROJ_MEMORY, "unknown": "x"}
    )
    assert response["isError"] is True
    after = conn.execute("SELECT updated_at FROM memories WHERE id = ?", (PROJ_MEMORY,)).fetchone()
    assert after["updated_at"] == before["updated_at"]


def test_update_on_deleted_entry_is_rejected(open_session, seeded, conn):
    session = open_session(seeded["proj"]["token"])
    forgotten = session.call("memory_forget", {"id": PROJ_MEMORY, "reason": "归档"})
    assert forgotten.get("isError") is not True
    response = session.call("memory_update", {"id": PROJ_MEMORY, "summary": "改"})
    assert response["isError"] is True
    assert response["content"][0]["text"] == f"记忆 {PROJ_MEMORY} 不存在或无权访问"


def test_read_only_key_cannot_write(open_session, seeded, conn):
    key = create_key(conn, "ro", {"proj": "r"})
    session = open_session(key["token"])
    before = row_count(conn)
    calls = [
        ("memory_save", {"group": "proj", "title": "t", "summary": "s", "body": "b"}),
        ("memory_update", {"id": PROJ_MEMORY, "summary": "s"}),
        ("memory_forget", {"id": PROJ_MEMORY, "reason": "r"}),
    ]
    for name, arguments in calls:
        result = session.call(name, arguments)
        assert result["isError"] is True, name
    assert row_count(conn) == before
    assert conn.execute(
        "SELECT deleted_at FROM memories WHERE id = ?", (PROJ_MEMORY,)
    ).fetchone()["deleted_at"] is None


def test_forbidden_and_missing_share_one_message(open_session, seeded, conn):
    key = create_key(conn, "proj-only", {"proj": "r"})
    session = open_session(key["token"])
    forbidden = session.call("memory_update", {"id": STUDY_MEMORY, "summary": "s"})
    missing = session.call("memory_update", {"id": "mem_zzz999", "summary": "s"})
    assert forbidden["isError"] is True and missing["isError"] is True
    # 文案模板逐字相同，唯一差异是调用方自己传入的 id。
    assert forbidden["content"][0]["text"].replace(STUDY_MEMORY, "{id}") == missing["content"][
        0
    ]["text"].replace("mem_zzz999", "{id}")
    assert missing["content"][0]["text"] == "记忆 mem_zzz999 不存在或无权访问"
    assert "study" not in forbidden["content"][0]["text"]


def test_read_only_group_reports_readonly_permission(open_session, seeded, conn):
    key = create_key(conn, "ro-proj", {"proj": "r"})
    response = open_session(key["token"]).call(
        "memory_update", {"id": PROJ_MEMORY, "summary": "s"}
    )
    assert response["isError"] is True
    assert "只读权限" in response["content"][0]["text"]


def test_forget_requires_a_reason(open_session, seeded, conn):
    session = open_session(seeded["proj"]["token"])
    for reason in ("", "   "):
        response = session.call("memory_forget", {"id": PROJ_MEMORY, "reason": reason})
        assert response["isError"] is True
        assert "删除原因不能为空" in response["content"][0]["text"]
    assert conn.execute(
        "SELECT deleted_at FROM memories WHERE id = ?", (PROJ_MEMORY,)
    ).fetchone()["deleted_at"] is None


def test_forget_is_idempotent_and_keeps_first_reason(open_session, seeded, conn):
    session = open_session(seeded["proj"]["token"])
    first = session.call("memory_forget", {"id": PROJ_MEMORY, "reason": "已完成"})
    assert first.get("isError") is not True
    row = conn.execute(
        "SELECT deleted_at, deleted_reason FROM memories WHERE id = ?", (PROJ_MEMORY,)
    ).fetchone()
    assert row["deleted_at"] is not None
    assert row["deleted_reason"] == "已完成"

    second = session.call("memory_forget", {"id": PROJ_MEMORY, "reason": "改主意"})
    assert second["isError"] is True
    row = conn.execute(
        "SELECT deleted_reason FROM memories WHERE id = ?", (PROJ_MEMORY,)
    ).fetchone()
    assert row["deleted_reason"] == "已完成"


def test_soft_deleted_entry_disappears_then_cli_restores_it(open_session, seeded, conn):
    session = open_session(seeded["proj"]["token"])
    assert session.call("memory_forget", {"id": PROJ_MEMORY, "reason": "过期归档"}).get(
        "isError"
    ) is not True

    assert PROJ_MEMORY not in session.text("memory_search", {})
    read = session.text("memory_read", {"ids": [PROJ_MEMORY]})
    assert "[不存在]" in read
    assert "正文里的机密内容" not in read

    listing = run_cli(db.db_path(), "memory", "list-deleted")
    assert listing.returncode == 0
    assert PROJ_MEMORY in listing.stdout
    assert "原因: 过期归档" in listing.stdout
    assert run_cli(db.db_path(), "memory", "list-deleted", "--group", "study").stdout.strip() == (
        "回收站为空"
    )

    restore = run_cli(db.db_path(), "memory", "restore", PROJ_MEMORY)
    assert restore.returncode == 0
    conn.commit()
    assert PROJ_MEMORY in session.text("memory_search", {})


def test_cli_restore_reports_unknown_id(seeded, conn):
    result = run_cli(db.db_path(), "memory", "restore", "mem_zzz999")
    assert result.returncode == 1
    assert "未找到" in result.stderr


def test_list_deleted_skips_live_entries(open_session, seeded, conn):
    listing = run_cli(db.db_path(), "memory", "list-deleted")
    assert listing.returncode == 0
    assert listing.stdout.strip() == "回收站为空"


# --- TASK-022 / TASK-023 数据访问入口 ---


def test_insert_memory_id_shape_and_persistence(conn, seeded):
    memory_id = dal.insert_memory(
        conn, group_slug="proj", title="t", summary="s", body="b", tags=["x"], review_at=None
    )
    assert re.fullmatch(r"mem_[a-z0-9]{6}", memory_id)
    conn.close()
    reopened = db.connect()
    try:
        row = reopened.execute(
            "SELECT tags FROM memories WHERE id = ?", (memory_id,)
        ).fetchone()
        assert json.loads(row["tags"]) == ["x"]
    finally:
        reopened.close()


def test_insert_memory_retries_after_id_collision(conn, seeded, monkeypatch):
    minted = iter([PROJ_MEMORY, "mem_fresh1"])
    monkeypatch.setattr("capsa.dal.new_memory_id", lambda: next(minted))
    memory_id = dal.insert_memory(
        conn, group_slug="proj", title="t", summary="s", body="b", tags=[], review_at=None
    )
    assert memory_id == "mem_fresh1"


def test_insert_memory_gives_up_after_three_collisions(conn, seeded, monkeypatch):
    monkeypatch.setattr("capsa.dal.new_memory_id", lambda: PROJ_MEMORY)
    with pytest.raises(dal.DuplicateMemoryId):
        dal.insert_memory(
            conn, group_slug="proj", title="t", summary="s", body="b", tags=[], review_at=None
        )


def test_insert_memory_does_not_retry_a_supplied_id(conn, seeded, monkeypatch):
    monkeypatch.setattr(
        "capsa.dal.new_memory_id", lambda: pytest.fail("explicit id must not be regenerated")
    )
    with pytest.raises(dal.DuplicateMemoryId) as collision:
        dal.insert_memory(
            conn,
            group_slug="proj",
            title="t",
            summary="s",
            body="b",
            tags=[],
            review_at=None,
            memory_id=PROJ_MEMORY,
        )
    assert collision.value.args[0] == PROJ_MEMORY


def test_insert_memory_foreign_key_failure_is_not_retried(conn, seeded, monkeypatch):
    minted: list[str] = []

    def mint() -> str:
        minted.append("call")
        return "mem_fresh2"

    monkeypatch.setattr("capsa.dal.new_memory_id", mint)
    with pytest.raises(sqlite3.IntegrityError):
        dal.insert_memory(
            conn, group_slug="missing", title="t", summary="s", body="b", tags=[], review_at=None
        )
    assert len(minted) == 1


def test_update_and_soft_delete_survive_reconnect(conn, seeded):
    assert dal.update_memory(conn, PROJ_MEMORY, {"summary": "改后摘要"}) is True
    assert dal.update_memory(conn, PROJ_MEMORY, {}) is False
    assert dal.soft_delete_memory(conn, PROJ_MEMORY, "归档") is True
    assert dal.soft_delete_memory(conn, PROJ_MEMORY, "覆盖") is False
    assert dal.update_memory(conn, PROJ_MEMORY, {"summary": "死后修改"}) is False
    conn.close()
    reopened = db.connect()
    try:
        row = reopened.execute(
            "SELECT summary, deleted_at, deleted_reason FROM memories WHERE id = ?",
            (PROJ_MEMORY,),
        ).fetchone()
        assert row["summary"] == "改后摘要"
        assert row["deleted_at"] is not None
        assert row["deleted_reason"] == "归档"
        deleted = dal.list_deleted_memories(reopened)
        assert [entry["id"] for entry in deleted] == [PROJ_MEMORY]
        assert dal.list_deleted_memories(reopened, "study") == []
    finally:
        reopened.close()


def test_restored_entry_is_visible_again(open_session, seeded, conn):
    assert dal.soft_delete_memory(conn, PROJ_MEMORY, "稍后恢复") is True
    assert dal.get_memories_batch_for_access(conn, [PROJ_MEMORY], {"proj": "rw"}) == [
        {"status": "not_found", "id": PROJ_MEMORY}
    ]
    assert dal.restore_memory(conn, PROJ_MEMORY) is True
    result = dal.get_memories_batch_for_access(conn, [PROJ_MEMORY], {"proj": "rw"})
    assert result[0]["status"] == "authorized"
    assert dal.restore_memory(conn, PROJ_MEMORY) is False
