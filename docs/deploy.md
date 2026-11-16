# Deploying to Railway

Four services in one Railway project: **api**, **web**, **Postgres**, and (optional) a metrics
scraper. Nothing here has been run on Railway yet; the first deploy should be to a staging
environment and follow the checklist at the end.

## 1. Database

Add the Postgres plugin. Note its `DATABASE_URL`. The API needs the async form,
`postgresql+asyncpg://...`; Railway gives `postgresql://...`, so set the variable on the api service
with the scheme changed.

## 2. API service (root directory `api/`, uses `api/Dockerfile`)

Variables:

| Variable | Value |
| --- | --- |
| `ENVIRONMENT` | `staging` or `production` (anything else but `local` turns on the safety checks) |
| `DATABASE_URL` | `postgresql+asyncpg://...` from step 1 (private network URL) |
| `WEB_ORIGIN` | the web service's public `https://` origin, exactly, no trailing slash |
| `COOKIE_SECRET` | 32+ random characters (`openssl rand -hex 32`) |
| `OPENAI_API_KEY` | the project key (required in production) |
| `TRUST_PROXY_HEADERS` | `true` (Railway's proxy sets `X-Forwarded-For`; needed for per-client rate limits) |
| `METRICS_TOKEN` | random string; the scraper sends it as a bearer token |
| `ADMIN_EMAILS` | comma-separated emails allowed to see the cost view |
| `SENTRY_DSN` | optional |
| `CAP_STT_SECONDS_DAILY`, `CAP_TOKENS_DAILY`, `CAP_RESEARCH_JOBS_DAILY` | per-user caps; defaults 5400, 500000, 10 |

Settings:

- **Pre-deploy command**: `alembic upgrade head`. It runs once per deploy before traffic moves.
- **Health check path**: `/readyz` (checks the database). `/healthz` is the bare process check.
- **Replicas**: start with 1. Audio sockets are held by one replica each; more replicas are fine
  because every session's state is in the database. See the socket limit in
  [operations](operations.md#load-test).
- The start command is in the Dockerfile: Uvicorn with a 60 s graceful shutdown, so a redeploy
  closes sockets with 1012 and browsers reconnect.

The API refuses to boot when a variable is unsafe (default secret, `http://` origin, default
database password, fake providers, missing key in production). The log line starts with
`Unsafe configuration:` and lists every problem.

### Sign-in email

**Not decided.** Sign-in links are emailed, and without a provider the API logs an error and no
one can sign in outside local development. Choose a provider (Resend, Postmark, SES, ...) and add
an `EmailSender` for it in `api/app/adapters/email.py`; this is the one blocker for a real beta.

## 3. Web service (root directory `web/`, uses `web/Dockerfile`)

Build argument: `VITE_API_BASE_URL` = the API's public `https://` origin.

Runtime variables (used by the nginx template for the Content-Security-Policy):

| Variable | Value |
| --- | --- |
| `API_ORIGIN` | the API's `https://` origin |
| `API_WS_ORIGIN` | the same host with `wss://` |

The container listens on port 8080 as a non-root user. Set Railway's target port to 8080.
The policy is strict (`script-src 'self'`, no inline scripts, connections only to the API); it was
verified in Chromium against the production build with the real headers, with zero violations
(`E2E_PROD=1 scripts/e2e-live.sh`). If the API's address changes, the web service must be redeployed
so the policy matches.

## 4. Domains and cookies

Use HTTPS custom domains. Tab capture and the microphone need a secure context. The session cookie
is `HttpOnly`, `Secure` and `SameSite=Lax`, and CORS allows only `WEB_ORIGIN`. Putting web and API
on sibling subdomains of one domain keeps the cookie same-site.

## 5. Metrics and alerts

Scrape `https://<api>/metrics` with `Authorization: Bearer <METRICS_TOKEN>` and load
`ops/alerts.yml` into the alert manager. Set the real daily budget in `DailySpendNearBudget`.

## First deploy checklist (staging)

- [ ] `GET /healthz` and `GET /readyz` return 200
- [ ] Sign-in link arrives and signs in (needs the email provider)
- [ ] Add a company, research finishes, brief shows citations
- [ ] Start a session with the consent box: tab audio captions appear, an outline streams
- [ ] Restart the api service mid-session: the page reconnects and marks the gap
- [ ] `/metrics` rejects no token and accepts the bearer token
- [ ] Response headers on the web page include the CSP; the browser console shows no violations
- [ ] `scripts/restore_drill.sh` against a copy of staging passes
- [ ] Real OpenAI check: confirm `OPENAI_REALTIME_PROTOCOL` (`beta` or `ga`) against the live
      service; the transcription protocol in this repository has not been exercised against
      OpenAI yet
