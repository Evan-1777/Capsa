"""Root ASGI application: /healthz plus the mounted MCP endpoint."""

from __future__ import annotations

from starlette.applications import Starlette
from starlette.middleware.body_limit import RequestBodyLimitMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from capsa.db import check_db_health
from capsa.mcp_service import mcp

MAX_REQUEST_BYTES = 1048576


async def healthz(request):
    if check_db_health():
        return JSONResponse({"status": "ok"}, status_code=200)
    return JSONResponse(
        {"status": "error", "message": "database unavailable"}, status_code=503
    )


# 子应用自带 /mcp 路径，根应用用 Route 直接挂载。
# 不用 Mount("/mcp", ...)：Mount 的路径正则是 ^/mcp/(?P<path>.*)$，裸 /mcp 只会
# 得到 307 跳转，而跳转更会因缺少 lifespan 上下文抛 task group 未初始化。
# 其 lifespan 必须交给根应用，否则 /mcp 请求抛 "task group was not initialized"。
mcp_app = mcp.http_app(path="/mcp")

routes = [
    Route("/healthz", endpoint=healthz, methods=["GET"]),
    Route("/mcp", endpoint=mcp_app, methods=["GET", "POST", "DELETE"]),
]

app = Starlette(routes=routes, lifespan=mcp_app.lifespan)
app.add_middleware(RequestBodyLimitMiddleware, max_body_size=MAX_REQUEST_BYTES)
