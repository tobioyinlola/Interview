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

## Status
- M0 scaffolding: done.
- M1 foundation: done — schema and migrations, email-link auth, notes autosave, consent-gated sessions,
  account deletion.
- M2 company research: done in code and tested with fakes and a real browser; **the OpenAI adapters have
  not been run against the live API yet** (needs a valid key), which is part of the M2 gate.
- Next: M3 live Meet session.
