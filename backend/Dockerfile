FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY pyproject.toml ./
RUN pip install --no-cache-dir .
COPY . .
RUN useradd --system --uid 10001 app && chown -R app /srv
USER app
EXPOSE 8000
# Long-running Uvicorn: WebSockets and streamed responses need a persistent process.
# Migrate, then serve. Migrations are idempotent; with several replicas run them as a pre-deploy step
# instead and set the start command to uvicorn alone.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --timeout-graceful-shutdown 60"]
