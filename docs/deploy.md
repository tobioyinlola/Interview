# Deploying to Railway

Four services in one Railway project: **api**, **web**, **Postgres**, and (optional) a metrics
scraper. Nothing here has been run on Railway yet; the first deploy should be to a staging
environment and follow the checklist at the end.

## 1. Database

Add the Postgres plugin. Note its `DATABASE_URL`. The API needs the async form,
`postgresql+asyncpg://...`; Railway gives `postgresql://...`, so set the variable on the api service
with the scheme changed.

## 2. API service (root directory `backend/`, uses `backend/Dockerfile`)

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
| `RESEND_API_KEY`, `EMAIL_FROM` | required; see below |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `API_PUBLIC_URL` | optional; see "Sign in with Google" |
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

### Sign in with Google

Optional. The sign-in and sign-up pages show "Continue with Google" only when it is configured.

1. In Google Cloud Console, create a project (or pick one) and configure the **OAuth consent
   screen** (app name InterviewMeet, your support email; scopes `openid` and `email` only).
2. Create an **OAuth client ID** of type *Web application*. Under *Authorized redirect URIs* add
   exactly `https://<api-domain>/api/auth/google/callback`.
3. On the api service set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `API_PUBLIC_URL`
   (`https://<api-domain>`, no trailing slash). The API refuses to boot if only one of the pair is
   set or the URL is not https.
4. While the consent screen is in *Testing*, only listed test users can sign in. Publish it
   before the public beta.

**If the Google button does not appear**, the API does not have both `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` (the API log says "google sign-in is off" at startup). **If Google shows
`redirect_uri_mismatch`**, the URI in the Google client must equal `API_PUBLIC_URL` plus
`/api/auth/google/callback` exactly (scheme, host, no trailing slash). **If you are sent back to the
login page with "Google sign-in didn't work"**, the API log has a `google sign-in refused` line with
the reason. **If you land signed out**, see "Domains and cookies".

The same email address is the same account whichever way it signs in. Only emails that Google has
verified are accepted. **Not yet tried against real Google**: the flow is tested against a mock
Google and a fake Google in a real browser, but needs a first real sign-in on staging.

### Passwords

Accounts made with an email use a password (at least 10 characters, typed twice, with a reveal
button). The account is created only when the emailed link is opened, which proves the address.
Passwords are stored as scrypt hashes. Ten wrong passwords for one email in 15 minutes pause password
sign-in for that email (the email link and Google still work). "Forgot password?" emails a reset
link that works once; using it signs the person out everywhere else. A person who only used Google
or email links can use the same reset link to add a password.

### Sign-in email (Resend)

Sign-in links are sent through [Resend](https://resend.com). Add and verify a sending domain in
Resend (DNS records), create an API key, then set `RESEND_API_KEY` and `EMAIL_FROM` (for example
`Meet Practice <login@yourdomain.com>`, an address on the verified domain). In staging and
production the API refuses to boot without both. A delivery failure is logged without the address or
link, and the sign-in endpoint still answers the same for every address.

## 3. Web service (root directory `frontend/`, uses `frontend/Dockerfile`)

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

**Put the web app and the API on the same site**, for example `app.example.com` and
`api.example.com`. Browsers treat two subdomains of a shared platform domain, such as two
`*.up.railway.app` addresses, as different sites and silently refuse to send the login cookie between
them, so nobody could stay signed in (email link, password and Google alike). The API checks this at
boot when `API_PUBLIC_URL` is set and refuses to start on such a pair.

Use HTTPS custom domains. Tab capture and the microphone need a secure context. The session cookie
is `HttpOnly`, `Secure` and `SameSite=Lax`, and CORS allows only `WEB_ORIGIN`. Putting web and API
on sibling subdomains of one domain keeps the cookie same-site.

## 5. Metrics and alerts

Scrape `https://<api>/metrics` with `Authorization: Bearer <METRICS_TOKEN>` and load
`ops/alerts.yml` into the alert manager. Set the real daily budget in `DailySpendNearBudget`.

## First deploy checklist (staging)

- [ ] `GET /healthz` and `GET /readyz` return 200
- [ ] Sign-in link arrives and signs in (needs the email provider)
- [ ] "Continue with Google" signs in and lands on the dashboard (needs the Google client)
- [ ] Add a company, research finishes, brief shows citations
- [ ] Start a session with the consent box: tab audio captions appear, an outline streams
- [ ] Restart the api service mid-session: the page reconnects and marks the gap
- [ ] `/metrics` rejects no token and accepts the bearer token
- [ ] Response headers on the web page include the CSP; the browser console shows no violations
- [ ] `scripts/restore_drill.sh` against a copy of staging passes
- [ ] Real OpenAI check: confirm `OPENAI_REALTIME_PROTOCOL` (`beta` or `ga`) against the live
      service; the transcription protocol in this repository has not been exercised against
      OpenAI yet
