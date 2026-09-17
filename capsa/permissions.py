"""Access policy: the one place that decides effective permission and the admin identity.

Kept below auth/dal/mcp_service in the import graph so every layer can share the
same rule without importing each other.
"""

from __future__ import annotations

import os

ADMIN_TOKEN_ENV = "CAPSA_ADMIN_TOKEN"
ADMIN_KEY_ID = "admin"
# 管理级令牌的固定身份：没有用户表，服务拥有者即唯一管理员。
ADMIN_GRANTS = {"*": "rw"}


def admin_token() -> str:
    """每次请求读取环境变量：改值重启即完成轮换，空值或纯空白一律视为未启用。"""
    return os.environ.get(ADMIN_TOKEN_ENV, "").strip()


def permission_for(grants: dict[str, str], group: str) -> str | None:
    """某分组的有效权限：通配 rw 覆盖一切，通配 r 只兜底未被特指的分组。"""
    if grants.get("*") == "rw":
        return "rw"
    if group in grants:
        return grants[group]
    return "r" if grants.get("*") == "r" else None
