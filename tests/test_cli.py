"""CLI acceptance: init idempotence, key length, revocation and persistence."""

from __future__ import annotations

import os
import re
import subprocess
import sys

import pytest

from capsa import dal, db
from capsa.ids import hash_token


def run_cli(db_path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "CAPSA_DB_PATH": str(db_path)}
    return subprocess.run(
        [sys.executable, "-m", "capsa.cli", *args],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


@pytest.fixture
def cli_db(tmp_path, monkeypatch):
    path = tmp_path / "capsa.db"
    monkeypatch.setenv("CAPSA_DB_PATH", str(path))
    return path


def test_init_twice_keeps_four_groups(cli_db):
    assert run_cli(cli_db, "init").returncode == 0
    second = run_cli(cli_db, "init")
    assert second.returncode == 0
    conn = db.connect()
    try:
        assert [group["slug"] for group in dal.list_groups(conn)] == [
            "life", "proj", "study", "track",
        ]
    finally:
        conn.close()


def test_key_create_prints_a_47_char_token(cli_db):
    run_cli(cli_db, "init")
    result = run_cli(cli_db, "key", "create", "smoke", "--scopes", "proj:rw,study:r")
    assert result.returncode == 0
    token = re.search(r"令牌: (\S+)", result.stdout).group(1)
    assert len(token) == 47
    conn = db.connect()
    try:
        stored = dal.find_active_key_by_hash(conn, hash_token(token))
        assert stored["scopes"] == {"proj": "rw", "study": "r"}
        key_id = stored["id"]
    finally:
        conn.close()

    assert run_cli(cli_db, "key", "revoke", key_id).returncode == 0
    conn = db.connect()
    try:
        assert dal.find_active_key_by_hash(conn, hash_token(token)) is None
        assert len(dal.list_keys(conn)) == 1
    finally:
        conn.close()


def test_key_revoke_reports_unknown_id(cli_db):
    run_cli(cli_db, "init")
    assert run_cli(cli_db, "key", "revoke", "nope0000").returncode == 1


def test_group_add_and_list(cli_db):
    assert run_cli(cli_db, "group", "add", "lab", "实验室", "--desc", "实验记录").returncode == 0
    listing = run_cli(cli_db, "group", "list")
    assert "lab | 实验室 | 实验记录" in listing.stdout


def test_data_survives_process_restart(cli_db):
    run_cli(cli_db, "init")
    run_cli(cli_db, "key", "create", "持久", "--scopes", "proj:r")
    conn = db.connect()
    try:
        before = (len(dal.list_groups(conn)), len(dal.list_keys(conn)))
    finally:
        conn.close()
    conn = db.connect()
    try:
        after = (len(dal.list_groups(conn)), len(dal.list_keys(conn)))
    finally:
        conn.close()
    assert before == after == (4, 1)
