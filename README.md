# InterviewMeet

React + FastAPI app that researches a company before a practice interview, then listens to a Google Meet
practice call (tab-audio sharing) and streams answer outlines grounded in the user's notes and a cited
company brief. **For practice with a partner who knows the assistant is on.** There is no feature to hide
the assistant or evade screen-share or proctoring, and none will be added.

## Layout
- `api/` FastAPI (async), SQLAlchemy 2, Alembic, Pydantic v2. Provider interfaces + fakes in `app/adapters/`.
- `web/` React, TypeScript, Vite, TanStack Query, Zustand, Tailwind. API types are generated from the OpenAPI schema.

## Local development
```bash
cp .env.example .env
docker compose up          # API :8000, web :5173, Postgres :5432
```
Without Docker:
```bash
cd api && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
uvicorn app.main:app --reload
cd web && npm ci && npm run dev
```

## Checks (also run in CI)
```bash
cd api && ruff check . && ruff format --check . && mypy app evals loadtest && pytest
cd web && npm run lint && npm run typecheck && npm test && npm run build
```
After changing API routes or schemas, regenerate the contract:
```bash
cd api && python scripts/export_openapi.py ../web/openapi.json && cd ../web && npm run gen:api
```

## Sign-in (local)
Email-link sign-in. With `ENVIRONMENT=local` the API logs the sign-in link to its console instead of
emailing it. Other environments send it through Resend (`RESEND_API_KEY`, `EMAIL_FROM`).

Tests need Postgres: `TEST_DATABASE_URL` (default `postgresql+asyncpg://postgres:postgres@localhost:5432/meetpractice_test`).
Create the database once with `createdb meetpractice_test`.

## Company research
Add a company (name, website, job posting link, up to 3 extra links, role, "what I already know"). A
background job reads the links, searches the web and writes a brief where **every fact cites a source**.
Facts with no valid source are dropped and empty sections say "Not found". Pages that can't be read
(blocked, sign-in, too large, timed out) are reported per link, and the user can paste the text instead.

- Fetching is SSRF-safe (`api/app/services/url_guard.py`, `fetcher.py`): public http(s) on ports 80/443
  only, every resolved address must be public, connections go to the checked IP with TLS verified against
  the real host name, every redirect is re-validated, 10 s / 2 MB limits, robots.txt, 1 request/s per host.
- Page text is passed to the model as quoted data; the output is schema-validated and cited against the
  sources the job actually collected.
- Needs `OPENAI_API_KEY` to research. Without it a job fails with a clear message.

## Live practice session
Sign in, save notes, optionally add a company, then **Practice**: tick the partner-consent box, start a
session, join Google Meet in another tab, and press **Share Meet tab** (pick the Meet tab and tick *Also
share tab audio*). The app transcribes the partner and streams an answer outline for each question.

- **Audio path:** browser AudioWorklet (1,024-sample frames) -> WebSocket -> API relay -> speech-to-text.
  The token is single-use, 60 s, sent as the first message (never in a URL). Audio is relayed and
  discarded; only finished utterances (text) are saved. A stalled provider is cut off after 5 s of
  buffered audio, a missed ping closes the socket, and the browser reconnects (1 s, 2 s, then 3 s apart,
  while the outage stays within 10 s).
- **Answers:** `POST /api/sessions/{id}/suggest` streams server-sent events. One model call decides
  whether the turn is a question (`NO_QUESTION`) and writes the outline (TYPE/OPENER/POINTS/CLOSE) from the
  notes snapshot and the company brief. Each bullet cites `[note: ...]` or `[brief: ...]`; a grounding
  check flags numbers or names that are in neither. A newer question cancels an unfinished one.
- **Limits:** daily caps on transcription seconds and tokens (`CAP_*`), enforced mid-session.

### Try it without OpenAI
`USE_FAKE_PROVIDERS=true` runs the whole live path with scripted transcription and answers (refused when
`ENVIRONMENT=production`). `scripts/e2e-live.sh` uses it to drive the real app in Chromium (see
`web/e2e/README.md`).

### Evaluations (need a valid key)
```bash
cd api && python -m evals.run detection   # 100 labelled utterances, pass at 90%
cd api && python -m evals.run grounding   # 30 questions x 3 note sets x with/without brief, pass at 95%
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
- **Not yet verified against OpenAI:** the research adapters, the realtime transcription protocol
  (`api/app/adapters/openai_realtime.py`), the fallback transcription call, answer scoring quality, real
  latency, and the evaluation scores. These need a valid key and a real Meet call.
- Not done: release hardening (observability, load test, staging, runbooks, legal review of the consent
  wording), the Railway deploy, and a sign-in email provider.

## Landing page and brand
`/` shows a public landing page to signed-out visitors (signed-in users go to `/dashboard`). It works in any
browser; the app itself needs desktop Chromium. Brand: Inter (self-hosted via `@fontsource-variable/inter`,
so the strict CSP holds) and four colours defined in `web/tailwind.config.js`: `#F7F4FF` canvas, `#FFFFFF`
surface, `#1C1B2E` ink, `#7B47F3` accent. The page states only what the product does: no invented
statistics, ratings, logos or testimonials, and every illustration is labelled "Example".

## Release hardening
- **Security:** startup refuses unsafe staging/production configuration; security headers on every response;
  body-size limits, per-client rate limits (stricter for sign-in); a 3 s database statement timeout;
  strict Content-Security-Policy for the web app (`web/nginx.conf.template`), verified in Chromium against the
  production build (`E2E_PROD=1 scripts/e2e-live.sh`).
- **Observability:** Prometheus `/metrics` (route templates only, never content), alert rules in
  `ops/alerts.yml` with a runbook each (`docs/runbooks/`), optional scrubbed Sentry, admin-only cost view at `/admin/usage`.
- **Reliability:** circuit breaker with a fallback answer model, stale research-job recovery, graceful
  shutdown that tells browsers to reconnect.
- **Checks you can run:** `scripts/loadtest.sh` (synthetic sessions, fake providers) and
  `scripts/restore_drill.sh` (backup restore check). Results and thresholds: [docs/operations.md](docs/operations.md).
- **Deploying:** [docs/deploy.md](docs/deploy.md).

## Status
Built and tested: sign-in, notes, company research, live sessions, review and scoring, hardening.
**Not yet verified against the real world** (needs a key, a call, or a deployment): OpenAI realtime
transcription protocol and answer quality (evals above), Docker builds, the GitHub Actions workflow,
Railway. **Open decisions:** transcript retention policy, daily budget figure.
