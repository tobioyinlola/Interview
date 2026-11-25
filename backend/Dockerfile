FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY pyproject.toml ./
# Set WITH_BROWSER=1 to build in Chromium and Playwright, for filling in employers' application forms
# (AUTOAPPLY_FORM_ADAPTER=browser). Off by default: it adds a few hundred MB to the image.
ARG WITH_BROWSER=0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pip install --no-cache-dir .
RUN if [ "$WITH_BROWSER" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends libatomic1 \
      && pip install --no-cache-dir ".[browser]" \
      && playwright install --with-deps chromium \
      && rm -rf /var/lib/apt/lists/* \
      && chmod -R a+rX /ms-playwright; \
    fi
COPY . .
RUN useradd --system --uid 10001 app && chown -R app /srv
USER app
EXPOSE 8000
# Long-running Uvicorn: WebSockets and streamed responses need a persistent process.
# Migrate, then serve. Migrations are idempotent; with several replicas run them as a pre-deploy step
# instead and set the start command to uvicorn alone.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --timeout-graceful-shutdown 60"]
