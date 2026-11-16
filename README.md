# Meet Practice Assistant

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
cd api && ruff check . && ruff format --check . && mypy app && pytest
cd web && npm run lint && npm run typecheck && npm test && npm run build
```
After changing API routes or schemas, regenerate the contract:
```bash
cd api && python scripts/export_openapi.py ../web/openapi.json && cd ../web && npm run gen:api
```

## Sign-in (local)
Email-link sign-in. With `ENVIRONMENT=local` the API logs the sign-in link to its console instead of
emailing it. Other environments need an email provider wired in `app/adapters/email.py` (open decision).

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

## Status
- M0 scaffolding: done.
- M1 foundation: done.
- M2 company research: done in code and tests; OpenAI adapters not yet run live.
- M3 live session: done in code and tests, and verified in a real browser with scripted providers.
  **Not yet verified:** the OpenAI realtime transcription protocol (`api/app/adapters/openai_realtime.py`),
  real-speech latency, and the evaluation scores. These need a valid key and a real Meet call.
- Next: M4 beta (brief editing and pins, mic capture, fallback transcription, floating panel,
  feedback, scoring, replay, gap finder).
