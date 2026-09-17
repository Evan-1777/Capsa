"""Administrative CLI: init, group, key."""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from capsa import dal, db, retrieval
from capsa.auth import issue_key
from capsa.ids import hash_token

BACKUP_KEEP_DAYS = 14
BACKUP_DIR_DEFAULT = "/backup"
BACKUP_PREFIX = "capsa-"

DEFAULT_GROUPS = [
    ("proj", "项目", "项目相关记忆：架构决策、实施进度与接口约定"),
    ("study", "学习", "学习笔记：技术原理、资料摘要与练习记录"),
    ("life", "生活", "生活记录：计划、清单与日常事务"),
    ("track", "追踪", "需要按期复核的追踪事项"),
]


def _connect() -> sqlite3.Connection:
    conn = db.connect()
    db.init_schema(conn)
    return conn


def _parse_scopes(raw: str) -> dict[str, str]:
    scopes: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if not pair:
            continue
        slug, sep, permission = pair.partition(":")
        slug = slug.strip()
        permission = permission.strip() if sep else "r"
        if slug:
            scopes[slug] = permission
    return scopes


def cmd_init(args: argparse.Namespace) -> int:
    conn = _connect()
    try:
        for slug, name, description in DEFAULT_GROUPS:
            dal.add_group(conn, slug, name, description)
    finally:
        conn.close()
    print(f"已预置标准分组：{', '.join(slug for slug, _, _ in DEFAULT_GROUPS)}")
    return 0


def cmd_group_add(args: argparse.Namespace) -> int:
    conn = _connect()
    try:
        if not dal.add_group(conn, args.slug, args.name, args.desc):
            print(f"分组 {args.slug} 已存在，未修改", file=sys.stderr)
            return 1
        group = dal.get_group(conn, args.slug)
    finally:
        conn.close()
    print(f"分组 {group['slug']} | {group['name']} | {group['description']}")
    return 0


def cmd_group_list(args: argparse.Namespace) -> int:
    conn = _connect()
    try:
        groups = dal.list_groups(conn)
    finally:
        conn.close()
    for group in groups:
        print(f"{group['slug']} | {group['name']} | {group['description']}")
    return 0


def cmd_group_delete(args: argparse.Namespace) -> int:
    conn = _connect()
    try:
        status = dal.delete_empty_group(conn, args.slug)
    finally:
        conn.close()
    if status == "not_found":
        print(f"未找到分组：{args.slug}", file=sys.stderr)
        return 1
    if status == "has_memories":
        print(f"分组 {args.slug} 下仍有记忆（含回收站），无法删除", file=sys.stderr)
        return 1
    print(f"已删除分组：{args.slug}")
    return 0


def cmd_key_create(args: argparse.Namespace) -> int:
    name = args.name.strip()
    if not name or len(name) > 60:
        print("Key 名称不能为空且不超过 60 字符", file=sys.stderr)
        return 1
    scopes = _parse_scopes(args.scopes)
    if not scopes:
        print("scopes 不能为空", file=sys.stderr)
        return 1
    conn = _connect()
    try:
        existing_groups = {g["slug"] for g in dal.list_groups(conn)}
        for slug, perm in scopes.items():
            if slug != "*" and slug not in existing_groups:
                print(f"未找到分组：{slug}", file=sys.stderr)
                return 1
            if perm not in ("r", "rw"):
                print(f"权限值必须是 r 或 rw，本次传入 {perm}", file=sys.stderr)
                return 1
        key_id, plain = issue_key()
        dal.create_key(conn, key_id, name, hash_token(plain), scopes)
    finally:
        conn.close()
    print(f"Key ID: {key_id}")
    print(f"令牌: {plain}")
    print("明文令牌仅本次显示，服务端只存 SHA256，之后无法找回。")
    return 0


def cmd_key_revoke(args: argparse.Namespace) -> int:
    conn = _connect()
    try:
        revoked = dal.revoke_key(conn, args.key_id)
    finally:
        conn.close()
    if revoked != "revoked":
        print(f"未找到可撤销的 Key：{args.key_id}", file=sys.stderr)
        return 1
    print(f"已撤销 Key：{args.key_id}")
    return 0


def cmd_key_list(args: argparse.Namespace) -> int:
    conn = _connect()
    try:
        keys = dal.list_keys(conn)
    finally:
        conn.close()
    for key in keys:
        state = f"已撤销 {key['revoked_at']}" if key["revoked_at"] else "有效"
        print(f"{key['id']} | {key['name']} | {key['scopes']} | {state}")
    return 0


def cmd_memory_list_deleted(args: argparse.Namespace) -> int:
    conn = _connect()
    try:
        entries = dal.list_deleted_memories(conn, args.group)
    finally:
        conn.close()
    if not entries:
        print("回收站为空")
        return 0
    for entry in entries:
        print(
            f"{entry['id']} | {entry['group_slug']} | 删除于 {entry['deleted_at']} | "
            f"原因: {entry['deleted_reason']}"
        )
    return 0


def cmd_memory_restore(args: argparse.Namespace) -> int:
    conn = _connect()
    try:
        restored = dal.restore_memory(conn, args.memory_id)
    finally:
        conn.close()
    if not restored:
        print(f"未找到可恢复的记忆：{args.memory_id}", file=sys.stderr)
        return 1
    print(f"已恢复记忆：{args.memory_id}")
    return 0


def cmd_review(args: argparse.Namespace) -> int:
    # CLI 是管理员通道，按读写权限取出全部已建分组。
    conn = _connect()
    try:
        scopes = {group["slug"]: "rw" for group in dal.list_groups(conn)}
        memories = dal.list_active_memories_for_search(conn, scopes, args.group)
    finally:
        conn.close()
    ranked = retrieval.rank_memories(memories, args.query or "")[: args.limit]
    if not ranked:
        print("没有符合条件的记忆")
        return 0
    for index, item in enumerate(ranked, start=1):
        print(
            f"[{index}] {item['id']} | {item['group_slug']} | "
            f"{item['updated_at'][:10]} | {item['title']}"
        )
    return 0


def cmd_backup(args: argparse.Namespace) -> int:
    target_dir = Path(args.target_dir or os.environ.get("CAPSA_BACKUP_DIR") or BACKUP_DIR_DEFAULT)
    target_dir.mkdir(parents=True, exist_ok=True)
    snapshot = target_dir / f"{BACKUP_PREFIX}{db.utcnow()[:10]}.db"
    source = db.connect()
    destination = sqlite3.connect(snapshot)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    print(f"已生成快照：{snapshot}")
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=args.keep_days)
    removed = 0
    for path in sorted(target_dir.glob(f"{BACKUP_PREFIX}*.db")):
        try:
            created = date.fromisoformat(path.name[len(BACKUP_PREFIX) : -len(".db")])
        except ValueError:
            continue
        if created <= cutoff:
            path.unlink()
            removed += 1
    print(f"已清理 {removed} 个过期快照")
    return 0


def cmd_restore(args: argparse.Namespace) -> int:
    snapshot = Path(args.snapshot_path)
    if not snapshot.is_file():
        print(f"未找到快照文件：{snapshot}", file=sys.stderr)
        return 1
    target_path = Path(db.db_path())
    target_path.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(snapshot)
    destination = db.connect()
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    print(f"已恢复：{snapshot} 到 {target_path}，请重启服务")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="capsa", description="Capsa 记忆服务管理命令")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("init", help="预置 proj/study/life/track 四个标准分组").set_defaults(
        func=cmd_init
    )

    group = commands.add_parser("group", help="分组维护")
    group_commands = group.add_subparsers(dest="group_command", required=True)
    group_add = group_commands.add_parser("add", help="新增分组")
    group_add.add_argument("slug")
    group_add.add_argument("name")
    group_add.add_argument("--desc", default="")
    group_add.set_defaults(func=cmd_group_add)
    group_commands.add_parser("list", help="列出分组").set_defaults(func=cmd_group_list)
    group_delete = group_commands.add_parser("delete", help="删除分组")
    group_delete.add_argument("slug")
    group_delete.set_defaults(func=cmd_group_delete)

    key = commands.add_parser("key", help="Key 签发与撤销")
    key_commands = key.add_subparsers(dest="key_command", required=True)
    key_create = key_commands.add_parser("create", help="签发 Key")
    key_create.add_argument("name")
    key_create.add_argument("--scopes", required=True, help="形如 proj:rw,study:r")
    key_create.set_defaults(func=cmd_key_create)
    key_revoke = key_commands.add_parser("revoke", help="撤销 Key")
    key_revoke.add_argument("key_id")
    key_revoke.set_defaults(func=cmd_key_revoke)
    key_commands.add_parser("list", help="列出 Key").set_defaults(func=cmd_key_list)

    memory = commands.add_parser("memory", help="回收站维护")
    memory_commands = memory.add_subparsers(dest="memory_command", required=True)
    memory_list = memory_commands.add_parser("list-deleted", help="列出回收站条目")
    memory_list.add_argument("--group", default=None, help="只列出指定分组")
    memory_list.set_defaults(func=cmd_memory_list_deleted)
    memory_restore = memory_commands.add_parser("restore", help="恢复已删除条目")
    memory_restore.add_argument("memory_id")
    memory_restore.set_defaults(func=cmd_memory_restore)

    review = commands.add_parser("review", help="按检索同源顺序审阅活跃记忆")
    review.add_argument("--group", default=None, help="只审阅指定分组")
    review.add_argument("--query", default=None, help="关键词，与 MCP memory_search 同源")
    review.add_argument("--limit", type=int, default=20, help="最多输出条数")
    review.set_defaults(func=cmd_review)

    backup = commands.add_parser("backup", help="生成在线热备快照并清理过期文件")
    backup.add_argument("target_dir", nargs="?", default=None, help="快照目录，默认 CAPSA_BACKUP_DIR 或 /backup")
    backup.add_argument("--keep-days", type=int, default=BACKUP_KEEP_DAYS, help="保留天数")
    backup.set_defaults(func=cmd_backup)

    restore = commands.add_parser("restore", help="用快照覆盖当前数据库")
    restore.add_argument("snapshot_path")
    restore.set_defaults(func=cmd_restore)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
