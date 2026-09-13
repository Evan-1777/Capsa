#!/usr/bin/env bash
# 起一个真实服务供 Playwright 使用：临时库、标准分组、两把 Key，最后 exec uvicorn。
# 用 exec 让 uvicorn 进程直接成为 webServer 的子进程，Playwright 才能正常收尾。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PORT="${CAPSA_E2E_PORT:-8123}"
RUN_DIR="$(mktemp -d)"
export CAPSA_DB_PATH="$RUN_DIR/capsa.db"

"$ROOT/.venv/bin/python" -m capsa.cli init >/dev/null

rw_token="$("$ROOT/.venv/bin/python" -m capsa.cli key create e2e-rw --scopes proj:rw,study:r,life:rw | sed -n 's/^令牌: //p')"
readonly_token="$("$ROOT/.venv/bin/python" -m capsa.cli key create e2e-ro --scopes proj:r,study:r | sed -n 's/^令牌: //p')"

printf '{"rw":"%s","readonly":"%s"}\n' "$rw_token" "$readonly_token" > "$ROOT/web/tests/keys.json"

exec "$ROOT/.venv/bin/python" -m uvicorn capsa.server:app --host 127.0.0.1 --port "$PORT"
