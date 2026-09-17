"""Phase 3 assembly: route order, conditional static mount and /healthz."""

from __future__ import annotations

from starlette.testclient import TestClient

from capsa.server import create_app
from tests.conftest import web_headers


def test_healthz_api_and_missing_root(tmp_path, seeded):
    # 显式指向不存在的目录：本机是否已构建 capsa/static 不应改变这条断言。
    with TestClient(create_app(str(tmp_path / "absent"))) as local:
        assert local.get("/healthz").status_code == 200
        response = local.get("/api/memories", headers=web_headers(seeded["admin"]["token"]))
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert response.json()["success"] is True
        # capsa/static 未构建时根路由不挂载，/ 是 404 而不是 HTML 或启动失败。
        assert local.get("/").status_code == 404


def test_static_mount_serves_html_without_hijacking_api(tmp_path, seeded):
    (tmp_path / "index.html").write_text("<html>capsa studio</html>", encoding="utf-8")
    with TestClient(create_app(str(tmp_path))) as local:
        root = local.get("/")
        assert root.status_code == 200
        assert "capsa studio" in root.text
        api = local.get("/api/memories", headers=web_headers(seeded["admin"]["token"]))
        assert api.headers["content-type"].startswith("application/json")
        assert api.json()["success"] is True
