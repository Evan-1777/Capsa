"""Phase 3 CLI operations: review same-source ordering and snapshot lifecycle."""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone

from capsa import db
from tests.conftest import insert_memory, web_headers
from tests.test_cli import run_cli

ID_LINE = re.compile(r"^\[\d+\] (mem_[a-z0-9]{6})", re.M)


def review_ids(db_path, *args: str) -> list[str]:
    result = run_cli(db_path, "review", *args)
    assert result.returncode == 0, result.stderr
    return ID_LINE.findall(result.stdout)


def today_stamp() -> str:
    return datetime.now(timezone.utc).date().isoformat()


# --- TASK-039 review 同源 ---


def test_review_sequence_matches_mcp_and_web(client, seeded, conn):
    insert_memory(conn, "mem_key002", "proj", "密钥轮换方案二稿", updated_at="2026-05-01T08:00:00+00:00")
    insert_memory(conn, "mem_key003", "proj", "密钥分发流程", updated_at="2026-06-01T08:00:00+00:00")
    headers = web_headers(seeded["proj"]["token"])
    web_ids = [
        item["id"]
        for item in client.get(
            "/api/memories", headers=headers, params={"group": "proj", "query": "密钥", "limit": 20}
        ).json()["data"]["items"]
    ]
    cli_ids = review_ids(db.db_path(), "--group", "proj", "--query", "密钥")
    assert web_ids == cli_ids
    assert web_ids == ["mem_key003", "mem_key002", "mem_aaa111"]


def test_review_sequence_matches_mcp_search(client, seeded, conn, open_session):
    insert_memory(conn, "mem_key002", "proj", "密钥轮换方案二稿", updated_at="2026-05-01T08:00:00+00:00")
    session = open_session(seeded["proj"]["token"])
    text = session.text("memory_search", {"query": "密钥", "group": "proj", "limit": 20})
    assert ID_LINE.findall(text) == review_ids(db.db_path(), "--group", "proj", "--query", "密钥")


def test_review_pinned_entry_leads_despite_older_update(conn, seeded):
    insert_memory(
        conn, "mem_pin001", "proj", "密钥置顶旧条目", pinned=1, updated_at="2025-01-01T00:00:00+00:00"
    )
    assert review_ids(db.db_path(), "--group", "proj", "--query", "密钥") == [
        "mem_pin001",
        "mem_aaa111",
    ]


def test_review_group_filter_and_empty_result(seeded):
    assert review_ids(db.db_path(), "--group", "study") == ["mem_bbb222"]
    result = run_cli(db.db_path(), "review", "--query", "完全不相干的词")
    assert result.returncode == 0
    assert result.stdout.strip() == "没有符合条件的记忆"


# --- TASK-040 backup / restore ---


def test_backup_writes_an_independent_snapshot(conn, seeded, tmp_path):
    insert_memory(conn, "mem_ccc333", "proj", "第三条")
    target = tmp_path / "snapshots"
    result = run_cli(db.db_path(), "backup", str(target))
    assert result.returncode == 0, result.stderr
    assert "已生成快照" in result.stdout
    snapshot = target / f"capsa-{today_stamp()}.db"
    assert snapshot.is_file()
    with sqlite3.connect(snapshot) as independent:
        assert independent.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 3
    # 备份不阻塞源库：同一连接随后仍可读写。
    insert_memory(conn, "mem_ddd444", "proj", "第四条")
    assert conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 4


def test_backup_is_idempotent_within_a_day(conn, seeded, tmp_path):
    first = run_cli(db.db_path(), "backup", str(tmp_path))
    second = run_cli(db.db_path(), "backup", str(tmp_path))
    assert first.returncode == 0 and second.returncode == 0
    assert len(list(tmp_path.glob("capsa-*.db"))) == 1


def test_backup_falls_back_to_the_environment_directory(monkeypatch, tmp_path, seeded):
    target = tmp_path / "env-backups"
    monkeypatch.setenv("CAPSA_BACKUP_DIR", str(target))
    result = run_cli(db.db_path(), "backup")
    assert result.returncode == 0, result.stderr
    assert (target / f"capsa-{today_stamp()}.db").is_file()


def test_backup_purges_only_expired_snapshot_names(tmp_path, seeded):
    stale = tmp_path / "capsa-2020-01-01.db"
    stale.write_bytes(b"stale")
    notes = tmp_path / "notes.txt"
    notes.write_text("keep", encoding="utf-8")
    result = run_cli(db.db_path(), "backup", str(tmp_path))
    assert result.returncode == 0
    assert not stale.exists()
    assert notes.read_text(encoding="utf-8") == "keep"
    assert "已清理 1 个过期快照" in result.stdout


def test_backup_keep_days_zero_removes_todays_snapshot(conn, seeded, tmp_path):
    result = run_cli(db.db_path(), "backup", str(tmp_path), "--keep-days", "0")
    assert result.returncode == 0
    assert list(tmp_path.glob("capsa-*.db")) == []


def test_restore_writes_the_snapshot_back(conn, seeded, tmp_path):
    insert_memory(conn, "mem_ccc333", "proj", "第三条")
    assert run_cli(db.db_path(), "backup", str(tmp_path)).returncode == 0
    conn.execute("DELETE FROM memories WHERE id = ?", ("mem_ccc333",))
    conn.commit()
    assert conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 2
    snapshot = tmp_path / f"capsa-{today_stamp()}.db"
    result = run_cli(db.db_path(), "restore", str(snapshot))
    assert result.returncode == 0, result.stderr
    assert "请重启服务" in result.stdout
    conn.close()
    reopened = db.connect()
    try:
        assert reopened.execute("SELECT title FROM memories WHERE id = ?", ("mem_ccc333",)).fetchone()[0] == "第三条"
    finally:
        reopened.close()


def test_restore_missing_snapshot_exits_one(seeded, tmp_path):
    result = run_cli(db.db_path(), "restore", str(tmp_path / "nope.db"))
    assert result.returncode == 1
    assert "未找到快照文件" in result.stderr
