# InterviewMeet

React + FastAPI app that researches a company before a practice interview, then listens to a Google Meet
practice call (tab-audio sharing) and streams answer outlines grounded in the user's CV and a cited
company brief. Also includes a stealth mode Tauri desktop overlay that syncs directly with the live session.

## Layout
- `backend/` (the API) FastAPI (async), SQLAlchemy 2, Alembic, Pydantic v2. Provider interfaces + fakes in `app/adapters/`.
- `frontend/` (the web app) React, TypeScript, Vite, TanStack Query, Zustand, Tailwind. API types are generated from the OpenAPI schema.
- `Desktop app/` (AudioCore stealth client) Tauri (Rust + React) thin-client overlay excluded from screen capture.

## Local development
```bash
cp .env.example .env
docker compose up          # API :8000, web :5173, Postgres :5432
```
Without Docker:
```bash
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
uvicorn app.main:app --reload
cd frontend && npm ci && npm run dev
```

## Checks (also run in CI)
```bash
cd backend && ruff check . && ruff format --check . && mypy app evals loadtest && pytest
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```
After changing API routes or schemas, regenerate the contract:
```bash
cd backend && python scripts/export_openapi.py ../frontend/openapi.json && cd ../frontend && npm run gen:api
```

## Sign-in (local)
Separate `/signup` and `/login` pages: email and password (confirmed by an emailed link, with reset by email), an
emailed single-use sign-in link, or "Continue with Google" when
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set (see docs/deploy.md). Email-link sign-in. With `ENVIRONMENT=local` the API logs the sign-in link to its console instead of
emailing it. Other environments send it through Resend (`RESEND_API_KEY`, `EMAIL_FROM`).

Sign-up asks for a full name (the dashboard greets the first name: "Hello, Jordan 👋"). A new account then
goes through four onboarding questions (goal, experience, timeline, what to work on); they can be skipped and
are changed later from the dashboard. Answers are stored on the user (`users.onboarding`).

Emails (sign-up confirmation, sign-in link, password reset, welcome, password-changed and account-deleted
notices) come from `backend/app/services/email_templates.py`: one HTML layout with a plain-text twin, dark-mode
styles and a fallback link. They use `SUPPORT_EMAIL` as the reply/contact address and the logo at
`frontend/public/email-logo.png` (served from `WEB_ORIGIN`).

Tests need Postgres: `TEST_DATABASE_URL` (default `postgresql+asyncpg://postgres:postgres@localhost:5432/meetpractice_test`).
Create the database once with `createdb meetpractice_test`.

## CV upload
The Notes page is a CV upload: PDF, Word (.docx) or plain text, up to 5 MB, 20 pages for a PDF. The server reads the
text (`backend/app/services/cv.py`), keeps that text and the file name, and discards the file. The type is decided from
the file's bytes, not its name; password-protected PDFs, scans with no text, old `.doc` files, oversized files, and
zip or XML bombs are refused with a plain-language reason. A CV longer than 16,000 characters is cut at a word and the
page says so. Outlines, the grounding check, scoring and the gap finder all work from this text. There is no OCR.

## Company research
Add a company (name, website, job posting link, up to 3 extra links, role, "what I already know"). A
background job reads the links, searches the web and writes a brief where **every fact cites a source**.
Facts with no valid source are dropped and empty sections say "Not found". Pages that can't be read
(blocked, sign-in, too large, timed out) are reported per link, and the user can paste the text instead.

- Fetching is SSRF-safe (`backend/app/services/url_guard.py`, `fetcher.py`): public http(s) on ports 80/443
  only, every resolved address must be public, connections go to the checked IP with TLS verified against
  the real host name, every redirect is re-validated, 10 s / 2 MB limits, robots.txt, 1 request/s per host.
- Page text is passed to the model as quoted data; the output is schema-validated and cited against the
  sources the job actually collected.
- Needs `OPENAI_API_KEY` to research. Without it a job fails with a clear message.

## Tour and Help
The first time the dashboard opens, a nine-step tour rings the real sidebar items, the search box and the
account button, and explains the live panel. It can be skipped (Escape or Skip tour) and is remembered on the
account (`users.tour_done_at`, `PUT /api/tour`). Take it again from the account menu or the Help page. On a
phone, where the menu is a drawer, a step whose item is hidden is shown in the middle of the screen with the
same words. `/help` has a quick start, how the live panel works, and common questions. The steps are in
`frontend/src/features/tour/steps.ts`; each target is a `data-tour` attribute.

## Sessions, the free trial and invites
Every account gets one free practice session. Each session after that will be pay per session; **payments
are not built yet**, so a person with no session left is told so (HTTP 402, `payment_required`) and pointed to
the invite page. Invite three people who sign up with your link (`/signup?ref=CODE`, and who confirm their
email) and you earn a free session, which you **redeem** on the Invite friends page before you can use it.
The code survives email-link, password and Google sign-up. Inviting yourself (including `+tag` and Gmail dot
variants of your own address) does not count, and neither does a sign-up from the inviter's own device
(a device-id cookie; or the same coarse device fingerprint from the same network address, in another
browser or a private window), nor a second account made on the same device as another invited one. Those
are recorded as "held" and the inviter is told. Only keyed hashes are kept, deleted with the account. Settings: `REFERRALS_PER_FREE_SESSION` (default 3) and
`ENFORCE_SESSION_CREDITS` (default true; only tests turn it off).

## Live practice session
Sign in, upload your CV, optionally add a company, then **Practice**: start a
session (the partner-consent agreement is the box ticked once, at sign-up; the app does not ask again), join Google Meet in another tab, and press **Share Meet tab** (pick the Meet tab and tick *Also
share tab audio*). The app transcribes the partner and streams an answer outline for each question.

- **Audio path:** browser AudioWorklet (1,024-sample frames) -> WebSocket -> API relay -> speech-to-text.
  The token is single-use, 60 s, sent as the first message (never in a URL). Audio is relayed and
  discarded; only finished utterances (text) are saved. A stalled provider is cut off after 5 s of
  buffered audio, a missed ping closes the socket, and the browser reconnects (1 s, 2 s, then 3 s apart,
  while the outage stays within 10 s).
- **Answers:** `POST /api/sessions/{id}/suggest` streams server-sent events. One model call decides
  whether the turn is a question (`NO_QUESTION`) and writes the outline (TYPE/OPENER/POINTS/CLOSE) from the
  CV snapshot and the company brief. Each bullet cites `[note: ...]` or `[brief: ...]`; a grounding
  check flags numbers or names that are in neither. A newer question cancels an unfinished one.
- **Limits:** daily caps on transcription seconds and tokens (`CAP_*`), enforced mid-session.

### Try it without OpenAI
`USE_FAKE_PROVIDERS=true` runs the whole live path with scripted transcription and answers (refused when
`ENVIRONMENT=production`). `scripts/e2e-live.sh` uses it to drive the real app in Chromium (see
`frontend/e2e/README.md`).

### Evaluations (need a valid key)
```bash
cd backend && python -m evals.run detection   # 100 labelled utterances, pass at 90%
cd backend && python -m evals.run grounding   # 30 questions x 3 note sets x with/without brief, pass at 95%
```
Re-run whenever a prompt or model changes. `--model` picks the live answer model.

## Beta features (M4)
- **Edit the brief:** pin, edit, delete or add your own facts (labelled *From you*). A refresh keeps your
  pins, edits and added facts and the search results they cite. Removing a source drops researched facts
  that cited only it, so no unsourced claim stays.
- **Microphone:** optionally transcribe your own voice (echo cancellation on). Lines are labelled *You*,
  never answered, and they end the partner's current turn.
- **Fallback transcription:** if live streaming fails twice in a row, the browser cuts speech into
  sentences and sends each to `POST /api/sessions/{id}/segment`; the user is told it is slower.
- **Floating panel:** the answer panel can move to a small always-on-top window (Document
  Picture-in-Picture, Chromium) so the capture tab stays visible.
- **Review:** session list, replay with outlines beside questions, thumbs on outlines, answer scoring
  (five 0-100 scores and two or three fixes per answer; needs the microphone so answers are recorded),
  and the gap finder (question types and company topics with nothing to draw on).
- **Dashboard:** readiness checklist, companies, recent sessions.

## Status
- M0 scaffolding, M1 foundation: done.
- M2 company research, M3 live session, M4 beta features: done in code and tests, and the live path is
  verified in a real browser with scripted providers (`scripts/e2e-live.sh`).
- **Verified live (Railway dev deployment, 2026-11-17):** the realtime transcription protocol
  (`backend/app/adapters/openai_realtime.py`, protocol `ga`): synthesized speech streamed through the deployed
  stack came back word for word, and the answer outline streamed from the answer model.
- **Not yet verified against OpenAI:** the research adapters, the fallback transcription call, answer scoring
  quality, real latency under a real Meet call, and the evaluation scores.
- Not done: release hardening (observability, load test, staging, runbooks, legal review of the consent
  wording), the Railway deploy, and a sign-in email provider.

## Landing page and brand
`/` shows a public landing page to signed-out visitors (signed-in users go to `/dashboard`). It works in any
browser; the app itself needs desktop Chromium. Brand: Inter (self-hosted via `@fontsource-variable/inter`,
so the strict CSP holds) and four colours defined in `frontend/tailwind.config.js`: `#F7F4FF` canvas, `#FFFFFF`
surface, `#1C1B2E` ink, `#7B47F3` accent. The page states only what the product does: no invented
statistics, ratings, logos or testimonials, and every illustration is labelled "Example".

The signed-in app uses a dark sidebar (Menu, Account, Support) with a greeting header, stat cards, quick actions,
a practice chart and a recent-sessions column. Every number comes from the user's own sessions; with fewer than
two sessions the chart says so instead of drawing a trend. On phones the sidebar becomes a menu drawer.

## Mobile
The form pages (sign up, log in, forgot and reset password, link check, terms, privacy) sit straight on the page
with no box around the form. Every control is at least 44 px tall (fields 48 px), form text is 16 px so iPhones do
not zoom on focus, the terms checkbox has a large tap area, and the layout respects the notch and home bar.
`frontend/e2e/responsive.cjs` checks 98 page and screen-size combinations (280 px up to tablet, plus landscape) for
sideways scrolling and undersized controls, and runs with the other browser tests in `scripts/e2e-live.sh`.

## Release hardening
- **Security:** startup refuses unsafe staging/production configuration; security headers on every response;
  body-size limits, per-client rate limits (stricter for sign-in); a 3 s database statement timeout;
  strict Content-Security-Policy for the web app (`frontend/nginx.conf.template`), verified in Chromium against the
  production build (`E2E_PROD=1 scripts/e2e-live.sh`).
- **Observability:** Prometheus `/metrics` (route templates only, never content), alert rules in
  `ops/alerts.yml` with a runbook each (`docs/runbooks/`), optional scrubbed Sentry, a staff-only back office at `/admin` with its own sign-in (users, activity log, referrals, marketing, quality, emails, cost); it is separate from the customer app and has no link inside it.
- **Reliability:** circuit breaker with a fallback answer model, stale research-job recovery, graceful
  shutdown that tells browsers to reconnect.
- **Checks you can run:** `scripts/loadtest.sh` (synthetic sessions, fake providers) and
  `scripts/restore_drill.sh` (backup restore check). Results and thresholds: [docs/operations.md](docs/operations.md).
- **Deploying:** [docs/deploy.md](docs/deploy.md).

## Status
Built and tested: sign-in, CV upload, company research, live sessions, review and scoring, hardening.
**Deployed:** a Railway dev environment (Postgres, backend, frontend) runs this branch; sign-up, password
login, CV upload, consent, the live audio socket and OpenAI transcription were checked on it.
**Not yet verified against the real world:** answer quality and the evaluation scores (evals above),
research adapters, a real Google Meet call, the GitHub Actions workflow, Google sign-in against real Google.
**Open decisions:** transcript retention policy, daily budget figure.
