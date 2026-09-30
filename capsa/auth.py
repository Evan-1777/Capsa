"""Bearer token issuance and the FastMCP token verifier."""

from __future__ import annotations

from urllib.parse import parse_qs

from fastmcp.server.auth import AccessToken, TokenVerifier

from capsa import dal, db
from capsa.ids import hash_token, new_key_id, new_secret
from capsa.permissions import ADMIN_GRANTS, ADMIN_KEY_ID, admin_token


class QueryTokenAuthMiddleware:
    """Extract token or access_token from query string and inject Bearer header if absent."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = list(scope.get("headers") or [])
        if any(k.lower() == b"authorization" for k, _ in headers):
            await self.app(scope, receive, send)
            return

        query_bytes = scope.get("query_string", b"")
        if not query_bytes:
            await self.app(scope, receive, send)
            return

        try:
            params = parse_qs(query_bytes.decode("utf-8", errors="replace"), keep_blank_values=True)
        except Exception:
            await self.app(scope, receive, send)
            return

        raw_token = None
        for key in ("token", "access_token"):
            values = params.get(key)
            if values:
                cand = values[0].strip()
                if cand:
                    raw_token = cand
                    break

        if not raw_token or not raw_token.isascii():
            await self.app(scope, receive, send)
            return

        new_headers = list(headers)
        new_headers.append((b"authorization", f"Bearer {raw_token}".encode("latin-1")))
        new_scope = dict(scope)
        new_scope["headers"] = new_headers
        await self.app(new_scope, receive, send)



def issue_key() -> tuple[str, str]:
    """Generate a key id and its plaintext token. Pure generation, no database access."""
    key_id = new_key_id()
    return key_id, f"capsa_{key_id}_{new_secret()}"


class CapsaTokenVerifier(TokenVerifier):
    """Look the token hash up on every request so revocation takes effect immediately."""

    async def verify_token(self, token: str) -> AccessToken | None:
        # 管理级令牌先于数据库校验：未配置时此路径不存在，配置后无需落库。
        admin = admin_token()
        if admin and token == admin:
            return AccessToken(
                token=token,
                client_id=ADMIN_KEY_ID,
                scopes=["capsa"],
                claims={"key_id": ADMIN_KEY_ID, "grants": ADMIN_GRANTS},
            )
        conn = db.connect()
        try:
            key = dal.find_active_key_by_hash(conn, hash_token(token))
            if key is None:
                return None
            # ponytail: the refresh runs inline on the event loop; at personal scale
            # this single UPDATE is far cheaper than a worker round-trip.
            dal.touch_last_used_at(conn, key["id"])
        finally:
            conn.close()
        return AccessToken(
            token=token,
            client_id=key["id"],
            scopes=["capsa"],
            claims={"key_id": key["id"], "grants": key["scopes"]},
        )
