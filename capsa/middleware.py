"""ASGI request body size guard."""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable, MutableMapping


class _PayloadTooLarge(Exception):
    pass


def _declared_length(headers: list[tuple[bytes, bytes]]) -> int | None:
    for name, value in headers:
        if name.lower() == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


async def _send_payload_too_large(
    send: Callable[[dict], Awaitable[None]], max_bytes: int
) -> None:
    body = json.dumps(
        {"error": "payload_too_large", "message": f"请求体超过 {max_bytes} 字节"},
        ensure_ascii=False,
    ).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class RequestSizeLimitMiddleware:
    """Reject request bodies above the limit with HTTP 413.

    A trustworthy content-length is checked first; otherwise the receive channel
    is wrapped and the real byte count is accumulated as it arrives. The boundary
    is strict: a body exactly at the limit passes through.
    """

    def __init__(self, app: Any, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(
        self,
        scope: MutableMapping[str, Any],
        receive: Callable[[], Awaitable[dict]],
        send: Callable[[dict], Awaitable[None]],
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = _declared_length(scope.get("headers", []))
        if declared is not None and declared > self.max_bytes:
            await _send_payload_too_large(send, self.max_bytes)
            return

        received = 0
        response_started = False

        async def receive_limited() -> dict:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _PayloadTooLarge
            return message

        async def send_tracked(message: dict) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive_limited, send_tracked)
        except _PayloadTooLarge:
            if response_started:
                raise
            await _send_payload_too_large(send, self.max_bytes)
