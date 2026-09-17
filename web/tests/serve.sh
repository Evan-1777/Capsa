#!/usr/bin/env bash
# 起一个真实服务供 Playwright 使用：临时库、标准分组、管理员与非管理员两把 Key，最后 exec uvicorn。
# 用 exec 让 uvicorn 进程直接成为 webServer 的子进程，Playwright 才能正常收尾。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PORT="${CAPSA_E2E_PORT:-8123}"
RUN_DIR="$(mktemp -d)"
export CAPSA_DB_PATH="$RUN_DIR/capsa.db"

"$ROOT/.venv/bin/python" -m capsa.cli init >/dev/null

# 管理台只接受通配管理员凭据；分组 Key 用于验证普通凭据被拦截。
admin_token="$("$ROOT/.venv/bin/python" -m capsa.cli key create e2e-admin --scopes "*:rw" | sed -n 's/^令牌: //p')"
rw_token="$("$ROOT/.venv/bin/python" -m capsa.cli key create e2e-rw --scopes proj:rw,study:r,life:rw | sed -n 's/^令牌: //p')"

printf '{"admin":"%s","rw":"%s"}\n' "$admin_token" "$rw_token" > "$ROOT/web/tests/keys.json"

exec "$ROOT/.venv/bin/python" -m uvicorn capsa.server:app --host 127.0.0.1 --port "$PORT"
