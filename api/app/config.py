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

    # Page fetching safety limits (design doc: fetcher rules).
    fetch_user_agent: str = "MeetPracticeAssistant/0.1 (+company research for interview practice)"
    fetch_timeout_seconds: float = 10.0
    fetch_max_bytes: int = 2 * 1024 * 1024
    fetch_max_redirects: int = 3
    fetch_host_interval_seconds: float = 1.0
    fetch_cache_hours: int = 24
    source_text_max_chars: int = 20_000

    # Research worker.
    research_concurrency: int = 3
    research_job_timeout_seconds: int = 180
    research_stale_after_seconds: int = 120
    research_prompt_chars: int = 60_000

    # Live audio relay (design doc section 5 and 9).
    stt_sample_rate: int = 24000  # provider's PCM rate; the browser captures at this rate
    audio_token_ttl_seconds: int = 60
    audio_auth_timeout_seconds: float = 5.0
    relay_buffer_seconds: float = 5.0  # max audio held for a stalled upstream
    ws_ping_seconds: float = 15.0
    usage_flush_seconds: float = 5.0

    # Live answers.
    suggest_first_token_timeout_seconds: float = 5.0
    suggest_total_timeout_seconds: float = 20.0
    suggest_prefilter_min_words: int = 3
    openai_answer_fallback_model: str = "gpt-4o-mini"
    openai_realtime_protocol: str = "beta"  # "beta" or "ga"; confirm on the first live run
    openai_realtime_url: str = "wss://api.openai.com/v1/realtime?intent=transcription"

    # Run the whole live path with scripted fakes (no OpenAI). Refused in production.
    use_fake_providers: bool = False

    # Auth (email-link sign-in).
    login_link_ttl_minutes: int = 15
    login_requests_per_hour: int = 5
    session_ttl_days: int = 30

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
