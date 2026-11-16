FROM python:3.15-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY pyproject.toml ./
RUN pip install --no-cache-dir .
COPY . .
RUN useradd --system --uid 10001 app && chown -R app /srv
USER app
EXPOSE 8000
# Long-running Uvicorn: WebSockets and streamed responses need a persistent process.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --timeout-graceful-shutdown 60"]
