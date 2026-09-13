"""Root ASGI application: /healthz, /mcp, the Web API and the built SPA."""

from __future__ import annotations

import os

from starlette.applications import Starlette
from starlette.middleware.body_limit import RequestBodyLimitMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from capsa.db import check_db_health
from capsa.mcp_service import mcp
from capsa.web_api import web_api_app

MAX_REQUEST_BYTES = 1048576

static_dir = os.path.join(os.path.dirname(__file__), "static")


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

def create_app(static_directory: str | None = None) -> Starlette:
    """Build the root application; the static root is mounted only when it exists."""
    directory = static_dir if static_directory is None else static_directory
    # 注册顺序固定：先具体前缀，再根路径静态托管，静态托管不得劫持 /api。
    routes = [
        Route("/healthz", endpoint=healthz, methods=["GET"]),
        Route("/mcp", endpoint=mcp_app, methods=["GET", "POST", "DELETE"]),
        Mount("/api", app=web_api_app),
    ]
    # capsa/static 是构建产物，未构建时不挂载根路由，/ 返回 404 而非启动失败。
    if os.path.isdir(directory):
        routes.append(Mount("/", app=StaticFiles(directory=directory, html=True)))
    application = Starlette(routes=routes, lifespan=mcp_app.lifespan)
    application.add_middleware(RequestBodyLimitMiddleware, max_body_size=MAX_REQUEST_BYTES)
    return application


app = create_app()
