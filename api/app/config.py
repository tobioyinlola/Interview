"""Settings read from environment variables only. No secret is ever returned by an endpoint."""

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "local"  # local | staging | production
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/meetpractice"
    web_origin: str = "http://localhost:5173"
    cookie_secret: SecretStr = SecretStr("dev-only-change-me")

    openai_api_key: SecretStr = SecretStr("")
    openai_answer_model: str = "gpt-4.1-mini"
    openai_stt_model: str = "gpt-4o-transcribe"
    openai_stt_fallback_model: str = "gpt-4o-mini-transcribe"
    openai_research_model: str = "gpt-4.1-mini"

    # Per-user daily caps (enforced from M3).
    cap_stt_seconds_daily: int = 5400
    cap_tokens_daily: int = 500_000
    cap_research_jobs_daily: int = 10

    # Research depth defaults (design doc, open question 4).
    research_site_pages: int = 3
    research_extra_links: int = 3
    research_searches: int = 2
    research_max_pages: int = 8
    research_budget_seconds: int = 90

    # Auth (email-link sign-in).
    login_link_ttl_minutes: int = 15
    login_requests_per_hour: int = 5
    session_ttl_days: int = 30

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
