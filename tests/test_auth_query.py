"""Tests for URL query parameter credential authentication (?token=... / ?access_token=...)."""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from tests.conftest import (
    INIT_PAYLOAD,
    auth_headers,
    parse_body,
)


def test_mcp_initialize_and_call_with_query_token(client: TestClient, seeded):
    """MCP streamable-HTTP session initialized and operated via ?token query parameter."""
    token = seeded["proj"]["token"]
    headers = auth_headers(None)

    # 1. initialize
    init_res = client.post(f"/mcp?token={token}", headers=headers, json=INIT_PAYLOAD)
    assert init_res.status_code == 200, init_res.text
    session_id = init_res.headers.get("mcp-session-id")
    assert session_id is not None

    headers["mcp-session-id"] = session_id

    # 2. notifications/initialized (notification returns 200 or 202 Accepted)
    notif_res = client.post(
        f"/mcp?token={token}",
        headers=headers,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
    )
    assert notif_res.status_code in (200, 202), notif_res.text

    # 3. tools/call memory_groups
    call_payload = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {"name": "memory_groups", "arguments": {}},
    }
    call_res = client.post(f"/mcp?token={token}", headers=headers, json=call_payload)
    assert call_res.status_code == 200, call_res.text
    result = parse_body(call_res)["result"]
    assert result.get("isError") is not True
    text = result["content"][0]["text"]
    assert "proj" in text
    assert "study" not in text


def test_mcp_initialize_with_rfc6750_access_token(client: TestClient, seeded):
    """MCP streamable-HTTP initialize succeeds with RFC 6750 ?access_token= parameter."""
    token = seeded["proj"]["token"]
    headers = auth_headers(None)
    init_res = client.post(f"/mcp?access_token={token}", headers=headers, json=INIT_PAYLOAD)
    assert init_res.status_code == 200, init_res.text
    assert "mcp-session-id" in init_res.headers


def test_web_api_with_query_token(client: TestClient, seeded):
    """Web REST API endpoints authenticate via ?token query parameter."""
    admin_token = seeded["admin"]["token"]

    # GET /api/groups?token=...
    res_groups = client.get(f"/api/groups?token={admin_token}")
    assert res_groups.status_code == 200
    data_groups = res_groups.json()
    assert data_groups["success"] is True
    assert isinstance(data_groups["data"]["items"], list)

    # GET /api/auth/me?token=...
    res_me = client.get(f"/api/auth/me?token={admin_token}")
    assert res_me.status_code == 200
    data_me = res_me.json()
    assert data_me["success"] is True
    assert data_me["data"]["key_id"] == seeded["admin"]["id"]


def test_web_api_with_rfc6750_access_token(client: TestClient, seeded):
    """Web REST API endpoints authenticate via RFC 6750 ?access_token= parameter."""
    admin_token = seeded["admin"]["token"]
    res = client.get(f"/api/groups?access_token={admin_token}")
    assert res.status_code == 200
    assert res.json()["success"] is True


def test_auth_priority_header_over_query(client: TestClient, seeded):
    """Authorization header is authoritative: wins when valid, and blocks fallback when invalid."""
    valid_token = seeded["admin"]["token"]
    invalid_token = "capsa_invalid_secret_key_123456789012345678"

    # 1. Valid Header + Invalid Query -> 200 (Header wins)
    res_header_wins = client.get(
        f"/api/groups?token={invalid_token}",
        headers={"Authorization": f"Bearer {valid_token}"},
    )
    assert res_header_wins.status_code == 200
    assert res_header_wins.json()["success"] is True

    # 2. Invalid Header + Valid Query -> 401 (Header authoritative, no query fallback)
    res_header_blocks = client.get(
        f"/api/groups?token={valid_token}",
        headers={"Authorization": f"Bearer {invalid_token}"},
    )
    assert res_header_blocks.status_code == 401
    assert res_header_blocks.json()["success"] is False
    assert res_header_blocks.json()["error"]["code"] == "UNAUTHORIZED"


def test_boundary_and_invalid_query_tokens(client: TestClient):
    """Boundary conditions: invalid, non-ASCII, empty, whitespace and absent tokens."""
    headers = auth_headers(None)

    # Invalid token -> 401
    res_invalid = client.post("/mcp?token=invalid_token_xyz", headers=headers, json=INIT_PAYLOAD)
    assert res_invalid.status_code == 401

    # Non-ASCII token in query parameter -> 401 (must not throw 500)
    res_non_ascii = client.post("/mcp?token=中文测试令牌", headers=headers, json=INIT_PAYLOAD)
    assert res_non_ascii.status_code == 401

    # URL-encoded non-ASCII token -> 401 (must not throw 500)
    res_encoded_non_ascii = client.post("/mcp?token=%E4%BD%A0%E5%A5%BD", headers=headers, json=INIT_PAYLOAD)
    assert res_encoded_non_ascii.status_code == 401

    # Empty token -> 401
    res_empty = client.post("/mcp?token=", headers=headers, json=INIT_PAYLOAD)
    assert res_empty.status_code == 401

    # Whitespace token -> 401
    res_spaces = client.post("/mcp?token=%20%20%20", headers=headers, json=INIT_PAYLOAD)
    assert res_spaces.status_code == 401

    # Control characters (CRLF) in token -> 401 (must not inject malformed header)
    res_crlf_embedded = client.post("/mcp?token=abc%0d%0aX-Evil:1", headers=headers, json=INIT_PAYLOAD)
    assert res_crlf_embedded.status_code == 401

    res_crlf_only = client.post("/mcp?token=%0d%0a", headers=headers, json=INIT_PAYLOAD)
    assert res_crlf_only.status_code == 401

    # Absent token -> 401
    res_absent = client.post("/mcp", headers=headers, json=INIT_PAYLOAD)
    assert res_absent.status_code == 401

    # Web API non-ASCII token -> 401 UNAUTHORIZED
    res_web_non_ascii = client.get("/api/groups?token=中文测试令牌")
    assert res_web_non_ascii.status_code == 401
    assert res_web_non_ascii.json()["error"]["code"] == "UNAUTHORIZED"
