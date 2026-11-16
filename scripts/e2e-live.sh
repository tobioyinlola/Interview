#!/usr/bin/env bash
# Runs the real-browser live-session test against a local stack with scripted (fake) transcription
# and answers, so no OpenAI key is needed. Requires: Postgres on localhost (see README), the API
# virtualenv, `npm ci` in web/, and Playwright's Chromium.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${E2E_OUT:-$(mktemp -d)}"
mkdir -p "$OUT"
PY="${API_PYTHON_BIN:-$ROOT/api/.venv/bin}"
export API_LOG="$OUT/api.log" API_PID="$OUT/api.pid" E2E_SHOTS="$OUT"
# `;` not `&&`: with `cd x && cmd &` the shell backgrounds the whole list, so $! would be a subshell.
export API_START="cd $ROOT/api; ENVIRONMENT=local USE_FAKE_PROVIDERS=true WEB_ORIGIN=http://localhost:5173 \
  nohup $PY/uvicorn app.main:app --port 8765 --timeout-graceful-shutdown 1 >> $API_LOG 2>&1 & echo \$! > $API_PID"
: > "$API_LOG"
(cd "$ROOT/api" && "$PY/alembic" upgrade head)
bash -c "$API_START"
(cd "$ROOT/web"; VITE_API_BASE_URL=http://localhost:8765 nohup ./node_modules/.bin/vite --port 5173 --strictPort > "$OUT/vite.log" 2>&1 & echo $! > "$OUT/vite.pid")
cleanup() { kill "$(cat "$API_PID")" "$(cat "$OUT/vite.pid")" 2>/dev/null || true; sleep 1; }
trap cleanup EXIT
for _ in $(seq 1 40); do curl -sf localhost:8765/healthz >/dev/null && curl -sf localhost:5173/ >/dev/null && break; sleep 0.5; done
NODE_PATH="$(npm root -g)" node "$ROOT/web/e2e/live-session.cjs"
echo "screenshots and logs in $OUT"
