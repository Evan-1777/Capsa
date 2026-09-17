"""Unit coverage for the storage base, the DAL contracts and the id helpers."""

from __future__ import annotations

import json
import re
import sqlite3

import anyio
import pytest

from capsa import dal, db, retrieval
from capsa.auth import CapsaTokenVerifier, issue_key
from capsa.ids import hash_token, new_memory_id
from tests.conftest import MARCH, create_key, insert_memory


# TASK-004 存储基座
def test_init_schema_is_idempotent(conn):
    db.init_schema(conn)
    db.init_schema(conn)
    tables = {row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"groups", "keys", "memories"} <= tables


def test_wal_and_foreign_keys_are_enabled(conn):
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    with pytest.raises(sqlite3.IntegrityError):
        insert_memory(conn, "mem_orphan", "missing", "孤儿条目")


def test_deleted_reason_column_exists(conn):
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(memories)")}
    assert "deleted_reason" in columns


def test_db_path_follows_environment(tmp_path, monkeypatch):
    target = tmp_path / "other.db"
    monkeypatch.setenv("CAPSA_DB_PATH", str(target))
    assert db.db_path() == str(target)


def test_check_db_health_requires_schema(monkeypatch, tmp_path):
    monkeypatch.setenv("CAPSA_DB_PATH", str(tmp_path / "capsa.db"))
    assert db.check_db_health() is False  # 文件已建但未建表
    connection = db.connect()
    db.init_schema(connection)
    connection.close()
    assert db.check_db_health() is True
    monkeypatch.setenv("CAPSA_DB_PATH", "/proc/nope/capsa.db")
    assert db.check_db_health() is False


# TASK-005 三态批量查询
def test_batch_returns_input_order_and_three_states(conn, seeded):
    result = dal.get_memories_batch_for_access(
        conn, ["mem_zzz999", "mem_bbb222", "mem_aaa111"], {"proj": "rw"}
    )
    assert [item["status"] for item in result] == ["not_found", "forbidden", "authorized"]
    assert [item["id"] for item in result] == ["mem_zzz999", "mem_bbb222", "mem_aaa111"]


def test_batch_skips_soft_deleted_entries(conn, seeded):
    conn.execute(
        "UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?",
        (db.utcnow(), "不再需要", "mem_aaa111"),
    )
    conn.commit()
    assert dal.get_memories_batch_for_access(conn, ["mem_aaa111"], {"proj": "rw"}) == [
        {"status": "not_found", "id": "mem_aaa111"}
    ]
    assert dal.list_active_memories_for_search(conn, {"proj": "rw"}) == []


def test_batch_empty_ids_returns_empty(conn):
    assert dal.get_memories_batch_for_access(conn, [], {"proj": "rw"}) == []


def test_forbidden_json_carries_no_group_title_or_summary(conn, seeded):
    payload = json.dumps(
        dal.get_memories_batch_for_access(conn, ["mem_bbb222"], {"proj": "rw"}),
        ensure_ascii=False,
    )
    assert payload == '[{"status": "forbidden", "id": "mem_bbb222"}]'


# TASK-006 授权范围检索列表
def test_search_list_is_scoped_and_body_free(conn, seeded):
    rows = dal.list_active_memories_for_search(conn, {"proj": "rw"})
    assert [row["id"] for row in rows] == ["mem_aaa111"]
    assert set(rows[0]) == {
        "id", "group_slug", "title", "summary", "tags", "review_at", "pinned", "updated_at",
    }
    assert dal.list_active_memories_for_search(conn, {}) == []


def test_search_list_group_filter(conn, seeded):
    assert [row["id"] for row in dal.list_active_memories_for_search(conn, {"proj": "rw", "study": "r"}, "study")] == ["mem_bbb222"]


def test_search_list_projects_body_only_on_demand(conn, seeded):
    """正文列按需投影：默认查询不读，显式开启才带回。"""
    assert "body" not in dal.list_active_memories_for_search(conn, {"proj": "rw"})[0]
    rows = dal.list_active_memories_for_search(conn, {"proj": "rw"}, include_body=True)
    assert rows[0]["body"] == "正文里的机密内容"


# TASK-007 分组入口
def test_add_group_keeps_first_description(conn):
    dal.add_group(conn, "proj", "项目", "首次描述")
    dal.add_group(conn, "proj", "项目", "二次描述")
    assert dal.get_group(conn, "proj")["description"] == "首次描述"
    assert dal.list_groups(conn) == [
        {"slug": "proj", "name": "项目", "description": "首次描述"}
    ]


def test_writes_survive_reconnect(conn):
    dal.add_group(conn, "proj", "项目", "描述")
    conn.close()
    reopened = db.connect()
    try:
        assert dal.get_group(reopened, "proj")["description"] == "描述"
    finally:
        reopened.close()


def test_group_counts_respect_scope_and_soft_delete(conn, seeded):
    conn.execute(
        "UPDATE memories SET deleted_at = ? WHERE id = ?",
        (db.utcnow(), "mem_aaa111"),
    )
    conn.commit()
    insert_memory(conn, "mem_ccc333", "proj", "仍在")
    groups = {group["slug"]: group for group in dal.list_groups_with_counts(conn, {"proj": "rw", "study": "r"})}
    assert groups["proj"]["count"] == 1
    assert groups["study"]["count"] == 1


def test_group_counts_and_permission(conn, seeded):
    insert_memory(conn, "mem_ccc333", "proj", "仍在")
    groups = {group["slug"]: group for group in dal.list_groups_with_counts(conn, {"proj": "r", "study": "rw"})}
    assert groups["proj"]["count"] == 2
    assert groups["proj"]["permission"] == "r"
    assert groups["study"]["count"] == 1
    assert groups["study"]["permission"] == "rw"
    assert dal.list_groups_with_counts(conn, {}) == []


# TASK-008 Key 入口
def test_revoked_key_is_not_found(conn):
    key = create_key(conn, "临时", {"proj": "rw"})
    assert dal.find_active_key_by_hash(conn, hash_token(key["token"]))["id"] == key["id"]
    assert dal.revoke_key(conn, key["id"]) == "revoked"
    assert dal.find_active_key_by_hash(conn, hash_token(key["token"])) is None
    assert dal.revoke_key(conn, key["id"]) == "already_revoked"
    assert dal.revoke_key(conn, "nope0000") == "not_found"


def test_delete_empty_group_atomic(conn, seeded):
    # 1. 不存在分组
    assert dal.delete_empty_group(conn, "nonexistent") == "not_found"
    # 2. 存在活跃记忆分组
    assert dal.delete_empty_group(conn, "proj") == "has_memories"
    assert dal.get_group(conn, "proj") is not None
    # 3. 仅含软删除记忆分组
    conn.execute("UPDATE memories SET deleted_at = ? WHERE group_slug = ?", (db.utcnow(), "proj"))
    conn.commit()
    assert dal.delete_empty_group(conn, "proj") == "has_memories"
    assert dal.get_group(conn, "proj") is not None
    # 4. 空分组删除成功
    dal.add_group(conn, "empty_grp", "空分组", "暂无记忆")
    assert dal.delete_empty_group(conn, "empty_grp") == "deleted"
    assert dal.get_group(conn, "empty_grp") is None


def test_delete_empty_group_concurrency(tmp_path, monkeypatch):
    db_file = str(tmp_path / "concurrent.db")
    monkeypatch.setenv("CAPSA_DB_PATH", db_file)
    conn1 = db.connect()
    db.init_schema(conn1)
    dal.add_group(conn1, "race_grp", "竞态测试", "描述")

    conn2 = db.connect()
    try:
        # conn1 开启 IMMEDIATE 事务获取写锁后，conn2 无法在检查到删除期间并发写入记忆
        conn1.execute("BEGIN IMMEDIATE")
        with pytest.raises(sqlite3.OperationalError):
            conn2.execute(
                "INSERT INTO memories (id, group_slug, title, summary, body, created_at, updated_at) "
                "VALUES ('mem_race', 'race_grp', 't', 's', 'b', '2026-01-01', '2026-01-01')"
            )
        conn1.rollback()

        # delete_empty_group 在 IMMEDIATE 事务内原子删除成功，conn2 即刻可见
        assert dal.delete_empty_group(conn1, "race_grp") == "deleted"
        assert dal.get_group(conn2, "race_grp") is None
    finally:
        conn1.close()
        conn2.close()


def test_delete_revoked_key_lifecycle(conn):
    key = create_key(conn, "生命周期测试", {"proj": "rw"})
    # 1. 有效 Key 拒绝物理删除
    assert dal.delete_revoked_key(conn, key["id"]) == "still_active"
    # 2. 吊销后再删除
    assert dal.revoke_key(conn, key["id"]) == "revoked"
    assert dal.delete_revoked_key(conn, key["id"]) == "deleted"
    # 3. 彻底从库中移除
    assert dal.get_key(conn, key["id"]) is None
    # 4. 再次删除返回 not_found
    assert dal.delete_revoked_key(conn, key["id"]) == "not_found"


def test_key_scopes_round_trip_and_persist(conn):
    key = create_key(conn, "持久", {"proj": "rw", "study": "r"})
    dal.touch_last_used_at(conn, key["id"])
    conn.close()
    reopened = db.connect()
    try:
        stored = dal.list_keys(reopened)[0]
        assert stored["scopes"] == {"proj": "rw", "study": "r"}
        assert stored["last_used_at"] is not None
        assert dal.find_active_key_by_hash(reopened, hash_token(key["token"]))["scopes"] == {
            "proj": "rw", "study": "r",
        }
    finally:
        reopened.close()


# TASK-009 标识符与校验器
def test_issued_token_shape():
    key_id, plain = issue_key()
    assert len(plain) == 47
    assert re.fullmatch(r"capsa_[a-z0-9]{8}_[A-Za-z0-9_-]{32}", plain), plain
    assert plain.split("_")[1] == key_id


def test_memory_id_shape():
    assert len(new_memory_id()) == 10
    assert new_memory_id().startswith("mem_")


def test_hash_token_is_stable():
    assert hash_token("abc") == hash_token("abc")
    assert len(hash_token("abc")) == 64


def test_verify_token_only_accepts_live_keys(conn):
    verifier = CapsaTokenVerifier()
    key = create_key(conn, "校验", {"proj": "rw"})
    assert anyio.run(verifier.verify_token, "capsa_invalid_00000000000000000000000000000000") is None
    token = anyio.run(verifier.verify_token, key["token"])
    assert token is not None
    assert token.client_id == key["id"]
    assert token.claims == {"key_id": key["id"], "grants": {"proj": "rw"}}
    dal.revoke_key(conn, key["id"])
    assert anyio.run(verifier.verify_token, key["token"]) is None


# TASK-011 分词
def test_tokenize_bigrams_and_edge_cases():
    assert retrieval.tokenize("记忆分组授权") == {"记忆", "忆分", "分组", "组授", "授权"}
    assert retrieval.tokenize("!!!  ") == set()
    assert retrieval.tokenize("") == set()
    assert retrieval.tokenize("AI 记忆") == {"ai", "记忆"}


def test_single_character_cjk_kept_whole():
    assert retrieval.tokenize("书") == {"书"}


def test_score_counts_duplicate_terms_once():
    memory = {"title": "授权 授权", "summary": "", "tags": "[]", "review_at": None, "pinned": 0}
    assert retrieval.score(memory, retrieval.tokenize("授权 授权")) == 4


# TASK-005 正文兜底命中与非对称低权重打分
def test_body_hits_are_off_by_default():
    memory = {"title": "无关", "summary": "无关", "tags": "[]", "review_at": None, "pinned": 0,
              "body": "xyzzy"}
    terms = retrieval.tokenize("xyzzy")
    assert retrieval._hits(memory, terms) is False
    assert retrieval._hits(memory, terms, include_body=True) is True


def test_body_hits_score_below_metadata_and_stay_capped():
    base = {"summary": "", "tags": "[]", "review_at": None, "pinned": 0}
    terms = retrieval.tokenize("xyzzy")
    body_only = {**base, "title": "无关", "body": "xyzzy"}
    assert retrieval.score(body_only, terms, include_body=True) == retrieval.BODY_HIT_WEIGHT
    summary_hit = {**base, "title": "无关", "summary": "xyzzy", "body": "无关"}
    title_hit = {**base, "title": "xyzzy", "summary": "", "body": "无关"}
    assert retrieval.score(summary_hit, terms, include_body=True) == 1.0
    assert retrieval.score(title_hit, terms, include_body=True) == 4.0
    many = retrieval.tokenize("xyzzy alpha beta gamma delta")
    stuffed = {**base, "title": "无关", "body": "xyzzy alpha beta gamma delta"}
    assert retrieval.score(stuffed, many, include_body=True) == retrieval.BODY_SCORE_CAP


def test_title_hit_outranks_body_hit_on_the_same_term():
    stamp = {"summary": "", "tags": "[]", "review_at": None, "pinned": 0, "updated_at": MARCH}
    title_hit = {**stamp, "id": "mem_title1", "title": "xyzzy 说明", "body": "无关"}
    body_hit = {**stamp, "id": "mem_body01", "title": "无关", "body": "xyzzy 暗号"}
    ranked = retrieval.rank_memories([body_hit, title_hit], "xyzzy", include_body=True)
    assert [memory["id"] for memory in ranked] == ["mem_title1", "mem_body01"]
