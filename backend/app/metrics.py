"""Prometheus metrics. Only ids, timings and counts: never transcript text, notes or page content.

Label values are drawn from small fixed sets (route templates, provider names, outcomes, close
codes) so cardinality stays bounded. Metric names are referenced by ops/alerts.yml, and a test fails
if an alert uses a metric that does not exist."""

import asyncio
import time

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

REGISTRY = CollectorRegistry()
CONTENT_TYPE = CONTENT_TYPE_LATEST

_LATENCY_BUCKETS = (0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0, 13.0, 21.0)
_HTTP_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)

http_requests = Counter(
    "http_requests_total", "HTTP requests", ["method", "route", "status"], registry=REGISTRY
)
http_duration = Histogram(
    "http_request_duration_seconds",
    "HTTP latency",
    ["route"],
    buckets=_HTTP_BUCKETS,
    registry=REGISTRY,
)

ws_open = Gauge("audio_websockets_open", "Open audio WebSockets", registry=REGISTRY)
ws_closes = Counter(
    "audio_websocket_closes_total", "Audio WebSocket closes by code", ["code"], registry=REGISTRY
)

# The core promise: question to first words. Server-side it is request to first streamed token.
answer_first_token = Histogram(
    "answer_first_token_seconds",
    "Suggest request to first streamed token",
    buckets=_LATENCY_BUCKETS,
    registry=REGISTRY,
)
answer_total = Histogram(
    "answer_total_seconds",
    "Suggest request to finished outline",
    buckets=_LATENCY_BUCKETS,
    registry=REGISTRY,
)
answer_stage = Histogram(
    "answer_stage_seconds",
    "Time spent in each stage of an answer",
    ["stage"],  # context | model_first_token
    buckets=_LATENCY_BUCKETS,
    registry=REGISTRY,
)
answers = Counter(
    "answers_total", "Answer requests by outcome", ["outcome"], registry=REGISTRY
)  # done | skip | error | repeat | fallback

provider_calls = Counter(
    "provider_calls_total",
    "Calls to outside services",
    [
        "provider",
        "operation",
        "outcome",
    ],  # stt|llm|search ; open|answer|brief|score|segment ; ok|error
    registry=REGISTRY,
)

research_jobs = Counter(
    "research_jobs_total", "Research jobs by end state", ["status"], registry=REGISTRY
)  # started | ready | failed
research_duration = Histogram(
    "research_job_duration_seconds",
    "Research job duration",
    buckets=(5, 15, 30, 60, 90, 120, 180),
    registry=REGISTRY,
)

stt_seconds = Counter("stt_audio_seconds_total", "Seconds of audio transcribed", registry=REGISTRY)
llm_tokens = Counter("llm_tokens_total", "Model tokens", ["direction"], registry=REGISTRY)
spend_usd = Counter(
    "estimated_spend_usd_total",
    "Estimated provider spend (see PRICE_* settings)",
    registry=REGISTRY,
)

# A histogram, not a gauge: a 400 ms stall between two scrapes would never show in a gauge.
event_loop_lag = Histogram(
    "event_loop_lag_seconds",
    "How late the event loop runs a 0.5 s timer",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5),
    registry=REGISTRY,
)
db_pool_in_use = Gauge(
    "db_pool_connections_in_use", "Checked-out DB connections", registry=REGISTRY
)
db_pool_capacity = Gauge("db_pool_connections_max", "Pool size plus overflow", registry=REGISTRY)
build_info = Gauge("app_info", "Running version", ["version"], registry=REGISTRY)


class _Prices:
    stt_per_second = 0.017 / 60
    llm_in = 0.40 / 1_000_000
    llm_out = 1.60 / 1_000_000


prices = _Prices()


def configure(settings: object) -> None:
    """Set unit prices from settings so the spend counter matches the owner's cost view."""
    prices.stt_per_second = float(settings.price_stt_per_minute) / 60  # type: ignore[attr-defined]
    prices.llm_in = float(settings.price_llm_input_per_million) / 1_000_000  # type: ignore[attr-defined]
    prices.llm_out = float(settings.price_llm_output_per_million) / 1_000_000  # type: ignore[attr-defined]


def record_stt_seconds(seconds: float) -> None:
    if seconds > 0:
        stt_seconds.inc(seconds)
        spend_usd.inc(seconds * prices.stt_per_second)


def record_tokens(input_tokens: int, output_tokens: int) -> None:
    if input_tokens > 0:
        llm_tokens.labels("input").inc(input_tokens)
    if output_tokens > 0:
        llm_tokens.labels("output").inc(output_tokens)
    spend_usd.inc(max(0, input_tokens) * prices.llm_in + max(0, output_tokens) * prices.llm_out)


def render() -> bytes:
    return generate_latest(REGISTRY)


async def monitor_loop(interval: float = 0.5) -> None:
    """Event-loop lag (an overloaded replica runs timers late) and DB pool saturation."""
    from app.db import get_engine

    while True:
        before = time.perf_counter()
        await asyncio.sleep(interval)
        event_loop_lag.observe(max(0.0, time.perf_counter() - before - interval))
        try:
            pool = get_engine().pool
            db_pool_in_use.set(pool.checkedout())  # type: ignore[attr-defined]
            db_pool_capacity.set(pool.size() + getattr(pool, "_max_overflow", 0))  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001, S110 - metrics must never break the app
            pass


# ---- Auto-Apply (counts and ages only: never a CV, an email body or an address)
autoapply_tick_timestamp = Gauge(
    "autoapply_tick_timestamp_seconds",
    "When the Auto-Apply scheduler last finished a pass",
    registry=REGISTRY,
)
autoapply_queue_age = Gauge(
    "autoapply_queue_age_seconds",
    "Age of the oldest application waiting to be sent",
    registry=REGISTRY,
)
autoapply_unresolved = Gauge(
    "autoapply_unresolved_attempts",
    "Send attempts whose outcome is still unknown",
    registry=REGISTRY,
)
autoapply_unresolved_age = Gauge(
    "autoapply_unresolved_attempt_age_seconds",
    "Age of the oldest attempt with an unknown outcome",
    registry=REGISTRY,
)
autoapply_mailbox_staleness = Gauge(
    "autoapply_mailbox_staleness_seconds",
    "Longest time since a connected mailbox was read",
    registry=REGISTRY,
)
autoapply_review_events = Gauge(
    "autoapply_events_needing_review",
    "Employer messages waiting for a person to match them",
    registry=REGISTRY,
)
autoapply_dispatch = Counter(
    "autoapply_dispatch_total",
    "Send attempts by channel and outcome",
    ["channel", "outcome"],
    registry=REGISTRY,
)
autoapply_form_changed = Counter(
    "autoapply_form_changes_total",
    "Sends stopped because the employer's form changed",
    registry=REGISTRY,
)
autoapply_duplicates = Counter(
    "autoapply_duplicates_prevented_total",
    "Repeat sightings that did not become a new application",
    registry=REGISTRY,
)
autoapply_discovery = Counter(
    "autoapply_discovery_runs_total",
    "Daily job searches by outcome",
    ["status"],
    registry=REGISTRY,
)
