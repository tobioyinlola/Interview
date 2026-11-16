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

## Status
M0 scaffolding done. Next: M1 foundation (data model, auth, notes, consent, account delete).
