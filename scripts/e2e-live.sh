#!/usr/bin/env bash
# Runs the real-browser live-session test against a local stack with scripted (fake) transcription
# and answers, so no OpenAI key is needed. Requires: Postgres on localhost (see README), the API
# virtualenv, `npm ci` in frontend/, and Playwright's Chromium.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${E2E_OUT:-${RUNNER_TEMP:+$RUNNER_TEMP/e2e}}"; OUT="${OUT:-$(mktemp -d)}"
mkdir -p "$OUT"
PY="${API_PYTHON_BIN:-$ROOT/backend/.venv/bin}"
export API_LOG="$OUT/api.log" API_PID="$OUT/api.pid" E2E_SHOTS="$OUT"
# E2E_PROXY=1 runs the deployed topology: the app is built with an empty API address and real nginx,
# rendered from frontend/nginx.conf.template, serves the pages and forwards /api (including the audio
# WebSocket and streamed answers) to the API, so the browser only ever talks to one origin.
PROXY="${E2E_PROXY:-0}"
if [ "$PROXY" = "1" ]; then API_PUBLIC=http://localhost:5173; export API_BASE=""; else API_PUBLIC=http://localhost:8765; export API_BASE="http://localhost:8765"; fi
# `;` not `&&`: with `cd x && cmd &` the shell backgrounds the whole list, so $! would be a subshell.
export API_START="cd $ROOT/backend; ENVIRONMENT=local USE_FAKE_PROVIDERS=true WEB_ORIGIN=http://localhost:5173 \
  RATE_LIMIT_AUTH_PER_MINUTE=1000 LOGIN_REQUESTS_PER_HOUR=1000 ADMIN_EMAILS=admin-e2e@example.com \
  GOOGLE_CLIENT_ID=e2e-client GOOGLE_CLIENT_SECRET=e2e-secret API_PUBLIC_URL=$API_PUBLIC \
  GOOGLE_AUTH_URL=http://localhost:9099/auth GOOGLE_TOKEN_URL=http://localhost:9099/token \
  nohup $PY/uvicorn app.main:app --port 8765 --timeout-graceful-shutdown 1 >> $API_LOG 2>&1 & echo \$! > $API_PID"
: > "$API_LOG"
(cd "$ROOT/backend" && "$PY/alembic" upgrade head)
bash -c "$API_START"
if [ "$PROXY" = "1" ]; then
  (cd "$ROOT/frontend" && VITE_API_BASE_URL= npm run build >/dev/null)
  N="$OUT/nginx"; mkdir -p "$N/tmp"
  API_UPSTREAM=127.0.0.1:8765 DNS_RESOLVER=127.0.0.53 API_ORIGIN= API_WS_ORIGIN= \
    envsubst '${API_UPSTREAM} ${DNS_RESOLVER} ${API_ORIGIN} ${API_WS_ORIGIN}' < "$ROOT/frontend/nginx.conf.template" \
    | sed "s|root /usr/share/nginx/html;|root $ROOT/frontend/dist;|; s|listen 8080;|listen 5173;|" > "$N/default.conf"
  cat > "$N/nginx.conf" <<NGINX
user $(id -un); worker_processes 1; pid $OUT/nginx.pid; error_log $N/error.log;
events { worker_connections 256; }
http { include /etc/nginx/mime.types; access_log $N/access.log;
  client_body_temp_path $N/tmp/c; proxy_temp_path $N/tmp/p; fastcgi_temp_path $N/tmp/f; uwsgi_temp_path $N/tmp/u; scgi_temp_path $N/tmp/s;
  include $N/default.conf; }
NGINX
  nginx -t -c "$N/nginx.conf" -p "$N"
  nginx -c "$N/nginx.conf" -p "$N"; sleep 0.5; cp "$OUT/nginx.pid" "$OUT/vite.pid"
elif [ "${E2E_PROD:-0}" = "1" ]; then
  # Production mode: build the app and serve it with the real security headers (strict CSP).
  (cd "$ROOT/frontend" && VITE_API_BASE_URL=http://localhost:8765 npm run build >/dev/null)
  (cd "$ROOT/frontend"; API_ORIGIN=http://localhost:8765 API_WS_ORIGIN=ws://localhost:8765 nohup node e2e/serve-prod.cjs 5173 > "$OUT/web.log" 2>&1 & echo $! > "$OUT/vite.pid")
else
  (cd "$ROOT/frontend"; VITE_API_BASE_URL=http://localhost:8765 nohup ./node_modules/.bin/vite --port 5173 --strictPort > "$OUT/vite.log" 2>&1 & echo $! > "$OUT/vite.pid")
fi
(cd "$ROOT/frontend"; nohup node e2e/fake-google.cjs > "$OUT/google.log" 2>&1 & echo $! > "$OUT/google.pid")
cleanup() { kill "$(cat "$API_PID")" "$(cat "$OUT/vite.pid")" "$(cat "$OUT/google.pid")" 2>/dev/null || true; sleep 1; }
trap cleanup EXIT
for _ in $(seq 1 40); do curl -sf localhost:8765/healthz >/dev/null && curl -sf localhost:5173/ >/dev/null && break; sleep 0.5; done
NODE_PATH="$(npm root -g)" node "$ROOT/frontend/e2e/live-session.cjs"
# The fake Google always signs in as the same person; forget them so reruns see a brand-new account
# (a new account is sent to onboarding, which the test checks).
PGPASSWORD=postgres psql -h localhost -U postgres meetpractice -qc "DELETE FROM users WHERE email='google.user@example.com'" >/dev/null 2>&1 || true
NODE_PATH="$(npm root -g)" node "$ROOT/frontend/e2e/google-signin.cjs"
NODE_PATH="$(npm root -g)" node "$ROOT/frontend/e2e/password-auth.cjs"
NODE_PATH="$(npm root -g)" node "$ROOT/frontend/e2e/referral.cjs"
NODE_PATH="$(npm root -g)" node "$ROOT/frontend/e2e/tour-guide.cjs"
NODE_PATH="$(npm root -g)" node "$ROOT/frontend/e2e/admin.cjs"
NODE_PATH="$(npm root -g)" node "$ROOT/frontend/e2e/responsive.cjs"
if [ "${E2E_TOUR:-0}" = "1" ]; then NODE_PATH="$(npm root -g)" node "$ROOT/frontend/e2e/tour.cjs"; fi
echo "screenshots and logs in $OUT"
