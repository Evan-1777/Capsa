"""Shared fixtures: isolated database, seed data and an HTTP MCP session."""

from __future__ import annotations

import json

import pytest
from starlette.testclient import TestClient

from capsa import dal, db
from capsa.auth import issue_key
from capsa.ids import hash_token

PROJ_MEMORY = "mem_aaa111"
STUDY_MEMORY = "mem_bbb222"
MARCH = "2026-03-11T08:00:00+00:00"
FEBRUARY = "2026-02-01T08:00:00+00:00"

INIT_PAYLOAD = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "pytest", "version": "1"},
    },
}


def auth_headers(token: str | None) -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def web_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def parse_body(response) -> dict:
    if "text/event-stream" in response.headers.get("content-type", ""):
        for line in response.text.splitlines():
            if line.startswith("data: "):
                return json.loads(line[6:])
        raise AssertionError(f"no data frame in {response.text!r}")
    return response.json()


def insert_memory(
    conn,
    memory_id: str,
    group: str,
    title: str,
    summary: str = "摘要",
    body: str = "正文",
    *,
    tags: str = "[]",
    review_at: str | None = None,
    pinned: int = 0,
    updated_at: str = MARCH,
) -> None:
    """Insert an entry directly; the write tools arrive in Phase 2."""
    conn.execute(
        "INSERT INTO memories (id, group_slug, title, summary, body, tags, review_at, pinned,"
        " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (memory_id, group, title, summary, body, tags, review_at, pinned, updated_at, updated_at),
    )
    conn.commit()


def create_key(conn, name: str, scopes: dict[str, str]) -> dict[str, str]:
    key_id, plain = issue_key()
    dal.create_key(conn, key_id, name, hash_token(plain), scopes)
    return {"id": key_id, "token": plain}


class McpSession:
    """Minimal streamable-HTTP client: initialize, then tools/call."""

    def __init__(self, client: TestClient, token: str):
        self.client = client
        self.headers = auth_headers(token)
        response = self.client.post("/mcp", headers=self.headers, json=INIT_PAYLOAD)
        assert response.status_code == 200, response.text
        self.headers["mcp-session-id"] = response.headers["mcp-session-id"]
        self._id = 1
        self.client.post(
            "/mcp",
            headers=self.headers,
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        )

    def _rpc(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        payload: dict = {"jsonrpc": "2.0", "id": self._id, "method": method}
        if params is not None:
            payload["params"] = params
        response = self.client.post("/mcp", headers=self.headers, json=payload)
        assert response.status_code == 200, response.text
        return parse_body(response)

    def list_tools(self) -> list[dict]:
        return self._rpc("tools/list")["result"]["tools"]

    def call(self, name: str, arguments: dict | None = None) -> dict:
        return self._rpc("tools/call", {"name": name, "arguments": arguments or {}})["result"]

    def text(self, name: str, arguments: dict | None = None) -> str:
        result = self.call(name, arguments)
        assert result.get("isError") is not True, result
        return result["content"][0]["text"]


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("CAPSA_DB_PATH", str(tmp_path / "capsa.db"))
    connection = db.connect()
    db.init_schema(connection)
    yield connection
    connection.close()


@pytest.fixture
def seeded(conn):
    dal.add_group(conn, "proj", "项目", "项目记忆")
    dal.add_group(conn, "study", "学习", "学习笔记")
    insert_memory(
        conn, PROJ_MEMORY, "proj", "项目密钥轮换方案", "摘要里的敏感实现细节", "正文里的机密内容"
    )
    insert_memory(
        conn,
        STUDY_MEMORY,
        "study",
        "OAuth 笔记",
        "摘要中的授权流程",
        "正文中的授权细节",
        updated_at=FEBRUARY,
    )
    return {
        "proj": create_key(conn, "proj-key", {"proj": "rw"}),
        "study": create_key(conn, "study-key", {"study": "rw"}),
        # 通配管理员：Web 管理台的唯一合法身份。
        "admin": create_key(conn, "admin-key", {"*": "rw"}),
    }


@pytest.fixture
def client(seeded):
    from capsa.server import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def bare_client(conn):
    from capsa.server import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def open_session(client):
    def _open(token: str) -> McpSession:
        return McpSession(client, token)

    return _open


@pytest.fixture
def initialize():
    def _initialize(client: TestClient, token: str | None):
        return client.post("/mcp", headers=auth_headers(token), json=INIT_PAYLOAD)

    return _initialize
