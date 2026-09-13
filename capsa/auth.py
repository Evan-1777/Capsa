"""Bearer token issuance and the FastMCP token verifier."""

from __future__ import annotations

from fastmcp.server.auth import AccessToken, TokenVerifier

from capsa import dal, db
from capsa.ids import hash_token, new_key_id, new_secret


def issue_key() -> tuple[str, str]:
    """Generate a key id and its plaintext token. Pure generation, no database access."""
    key_id = new_key_id()
    return key_id, f"capsa_{key_id}_{new_secret()}"


class CapsaTokenVerifier(TokenVerifier):
    """Look the token hash up on every request so revocation takes effect immediately."""

    async def verify_token(self, token: str) -> AccessToken | None:
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
