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

## Status
- M0 scaffolding: done.
- M1 foundation: done — 11-table schema and migration, email-link auth with cookie sessions and CSRF header,
  notes with autosave, consent-enforced session creation (with idempotency), account deletion, settings page.
- Next: M2 company research.
