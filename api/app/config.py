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

    # Hardening.
    metrics_token: SecretStr = SecretStr("")  # Bearer token for /metrics ("" = open only in local)
    sentry_dsn: str = ""
    # Sign in with Google (OpenID Connect). Both must be set to turn it on. Register this redirect
    # URI in Google Cloud: `{api_public_url}/api/auth/google/callback`.
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    api_public_url: str = "http://localhost:8000"  # the API's own public origin
    # Google's real endpoints. Only a local test with a fake Google may change them.
    google_auth_url: str = "https://accounts.google.com/o/oauth2/v2/auth"
    google_token_url: str = "https://oauth2.googleapis.com/token"  # noqa: S105
    resend_api_key: SecretStr = SecretStr("")  # sends the sign-in email
    email_from: str = ""  # e.g. "Meet Practice <login@yourdomain.com>", a Resend-verified domain
    admin_emails: str = ""  # comma-separated; may open the usage and cost view
    trust_proxy_headers: bool = False  # read the client IP from X-Forwarded-For (behind a proxy)
    rate_limit_per_minute: int = 600  # general /api limit per client
    rate_limit_auth_per_minute: int = 30  # sign-in endpoints, stricter
    max_body_bytes: int = 1_000_000
    max_audio_body_bytes: int = 2 * 1024 * 1024 + 4096  # POST .../segment
    db_statement_timeout_ms: int = 3000
    db_pool_size: int = 10
    db_max_overflow: int = 10

    # Unit prices for the owner's cost estimate (confirm against OpenAI's pricing page).
    price_stt_per_minute: float = 0.017
    price_llm_input_per_million: float = 0.40
    price_llm_output_per_million: float = 1.60

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
