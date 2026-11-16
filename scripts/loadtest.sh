#!/usr/bin/env bash
# Starts the API in fake-provider mode with rate limits raised (the load comes from one address)
# and runs api/loadtest/run.py against it. Requires Postgres on localhost and the API virtualenv.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${LOAD_OUT:-$(mktemp -d)}"; mkdir -p "$OUT"
PY="${API_PYTHON_BIN:-$ROOT/api/.venv/bin}"
USERS="${USERS:-40}"; SECONDS_LONG="${SECONDS_LONG:-24}"
: > "$OUT/api.log"
(cd "$ROOT/api" && "$PY/alembic" upgrade head >/dev/null)
(cd "$ROOT/api"; ENVIRONMENT=local USE_FAKE_PROVIDERS=true WEB_ORIGIN=http://localhost:5173 \
  RATE_LIMIT_PER_MINUTE=1000000 RATE_LIMIT_AUTH_PER_MINUTE=100000 LOGIN_REQUESTS_PER_HOUR=1000 \
  nohup "$PY/uvicorn" app.main:app --port 8765 >> "$OUT/api.log" 2>&1 & echo $! > "$OUT/api.pid")
trap 'kill "$(cat "$OUT/api.pid")" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf localhost:8765/healthz >/dev/null && break; sleep 0.5; done
cd "$ROOT/api"
"$PY/python" loadtest/run.py --users "$USERS" --seconds "$SECONDS_LONG" --log "$OUT/api.log" --out "$OUT/result.json" --pid-file "$OUT/api.pid" --stagger "${STAGGER:-0}"
