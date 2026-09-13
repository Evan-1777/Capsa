"""Fixed plain-text rendering contracts for the read tools and group listing."""

from __future__ import annotations

import json
from datetime import datetime

from capsa.retrieval import is_expired

MAX_BODY_CHARS = 4000
MAX_RESPONSE_CHARS = 20000


def _ids_literal(ids: list[str]) -> str:
    return json.dumps(ids, ensure_ascii=False)


def _date(value: str | None) -> str:
    return (value or "")[:10]


def _tags(raw: str | None) -> str:
    tags = json.loads(raw or "[]")
    return ",".join(tags) if tags else "-"


def _is_forbidden(item: dict) -> bool:
    return item.get("status") == "forbidden"


def _is_missing(item: dict) -> bool:
    return item.get("status") == "not_found"


def format_groups(groups: list[dict]) -> str:
    lines = ["# 可访问分组"]
    for group in groups:
        lines.append(
            f"- {group['slug']} | {group['name']} | {group['permission']} | "
            f"{group['count']} 条 | {group['description']}"
        )
    return "\n".join(lines)


def format_search(
    query: str,
    ranked: list[dict],
    scopes: dict[str, str],
    now: datetime | None = None,
) -> str:
    lines = [
        f'# 记忆检索: "{query}" | 命中 {len(ranked)} 条 | 范围: {",".join(sorted(scopes))}'
    ]
    ids: list[str] = []
    for index, item in enumerate(ranked, start=1):
        if _is_forbidden(item):
            lines.append(f"[{index}] {item['id']} | [无权访问]")
            continue
        expired = "（复核已过期）" if is_expired(item.get("review_at"), now) else ""
        lines.append(
            f"[{index}] {item['id']} | {item['group_slug']} | {_date(item['updated_at'])} | "
            f"标签: {_tags(item['tags'])}"
        )
        lines.append(f"    {item['title']}{expired}")
        ids.append(item["id"])
    if ids:
        lines.append(f"> 下一步: memory_peek(ids={_ids_literal(ids)})")
    return "\n".join(lines)


def format_peek(items: list[dict]) -> str:
    lines: list[str] = []
    ids: list[str] = []
    for index, item in enumerate(items, start=1):
        if _is_forbidden(item):
            lines.append(f"[{index}] {item['id']} | [无权访问]")
            continue
        if _is_missing(item):
            lines.append(f"[{index}] {item['id']} | [不存在]")
            continue
        lines.append(
            f"[{index}] {item['id']} | {item['group_slug']} | 更新 {_date(item['updated_at'])}"
        )
        lines.append(f"    标题: {item['title']}")
        lines.append(f"    摘要: {item['summary']}")
        ids.append(item["id"])
    if ids:
        lines.append(f"> 下一步: memory_read(ids={_ids_literal(ids)})")
    return "\n".join(lines)


def format_read(items: list[dict], offset: int = 0) -> str:
    lines: list[str] = []
    consumed = 0
    truncated: list[str] = []
    for index, item in enumerate(items, start=1):
        if _is_forbidden(item):
            lines.append(f"[{index}] {item['id']} | [无权访问]")
            continue
        if _is_missing(item):
            lines.append(f"[{index}] {item['id']} | [不存在]")
            continue
        if consumed >= MAX_RESPONSE_CHARS:
            break
        body = item["body"]
        available = max(len(body) - offset, 0)
        take = min(MAX_BODY_CHARS, available, MAX_RESPONSE_CHARS - consumed)
        consumed += take
        header = (
            f"===== {item['id']} | {item['group_slug']} | 更新 {_date(item['updated_at'])} ====="
        )
        if available > take:
            header += f" [截断: 本条剩余 {available - take} 字符未返回]"
            truncated.append(item["id"])
        lines.append(header)
        lines.append(f"# {item['title']}")
        lines.append("")
        lines.append(body[offset : offset + take])
        lines.append("")
    if truncated:
        lines.append(
            f"> 续读: memory_read(ids={_ids_literal(truncated)}, offset={offset + MAX_BODY_CHARS})"
        )
    return "\n".join(lines)
