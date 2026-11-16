import asyncio
import re
import uuid
from pathlib import Path

import httpx
import pytest
import yaml

from app import metrics
from app.adapters.interfaces import ProviderError
from app.config import Settings, get_settings
from app.main import create_app
from app.observability import init_sentry, scrub_event
from app.repositories import UsageMeterRepo
from app.services.breaker import CircuitBreaker
from tests.conftest import TEST_DB
from tests.helpers import GOOD_OUTLINE, NOTES


def sample(name: str, **labels) -> float:
    return metrics.REGISTRY.get_sample_value(name, labels) or 0.0


@pytest.fixture
async def alice(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "alice@example.com")
        await c.put("/api/notes", json={"role": "PM", "content": NOTES})
        yield c


async def mk(client):
    return (await client.post("/api/sessions", json={"consent": True})).json()["session_id"]


# ------------------------------------------------------------- /metrics endpoint


@pytest.fixture(autouse=True)
async def fresh_engine(monkeypatch, engine):
    from app import db as dbmod

    monkeypatch.setattr(dbmod, "_engine", None)
    monkeypatch.setattr(dbmod, "_sessionmaker", None)
    yield
    if dbmod._engine is not None:
        await dbmod._engine.dispose()


def client_with(monkeypatch, **over) -> httpx.AsyncClient:
    s = Settings(**{"environment": "local", "database_url": TEST_DB, **over})  # type: ignore[arg-type]
    monkeypatch.setattr("app.main.get_settings", lambda: s)
    monkeypatch.setattr("app.db.get_settings", lambda: s)
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: s  # the route reads settings via Depends
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def test_metrics_are_open_in_local_development(monkeypatch):
    async with client_with(monkeypatch) as c:
        r = await c.get("/metrics")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert "http_requests_total" in r.text and "answer_first_token_seconds" in r.text


async def test_metrics_do_not_exist_outside_local_without_a_token(monkeypatch):
    async with client_with(monkeypatch, environment="staging") as c:
        assert (await c.get("/metrics")).status_code == 404


async def test_metrics_need_the_bearer_token_when_one_is_set(monkeypatch):
    async with client_with(monkeypatch, environment="staging", metrics_token="s3cret-token") as c:
        assert (await c.get("/metrics")).status_code == 401
        assert (
            await c.get("/metrics", headers={"authorization": "Bearer wrong"})
        ).status_code == 401
        assert (
            await c.get("/metrics", headers={"authorization": "s3cret-token"})
        ).status_code == 401
        ok = await c.get("/metrics", headers={"authorization": "Bearer s3cret-token"})
        assert ok.status_code == 200 and "http_requests_total" in ok.text
    async with client_with(monkeypatch, metrics_token="tok") as c:  # a token also protects local
        assert (await c.get("/metrics")).status_code == 401


async def test_the_metrics_route_is_not_in_the_public_api_schema(monkeypatch):
    async with client_with(monkeypatch) as c:
        assert "/metrics" not in (await c.get("/openapi.json")).json()["paths"]


# ------------------------------------------------------------------ HTTP metrics


async def test_requests_are_counted_by_route_template_never_by_raw_path(monkeypatch):
    before = sample(
        "http_requests_total", method="GET", route="/api/companies/{company_id}", status="401"
    )
    cid = uuid.uuid4()
    async with client_with(monkeypatch) as c:
        await c.get(f"/api/companies/{cid}")
        await c.get("/api/definitely-not-a-route")
        text = (await c.get("/metrics")).text
    after = sample(
        "http_requests_total", method="GET", route="/api/companies/{company_id}", status="401"
    )
    assert after == before + 1
    assert sample("http_requests_total", method="GET", route="unmatched", status="404") >= 1
    assert (
        str(cid) not in text
    )  # ids never become label values (unbounded cardinality, and private)
    assert sample("http_request_duration_seconds_count", route="/api/companies/{company_id}") >= 1


async def test_exposition_never_contains_a_uuid_or_an_email_after_real_traffic(alice):
    await mk(alice)
    text = metrics.render().decode()
    assert not re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", text)
    assert "alice@example.com" not in text


# -------------------------------------------------------------- answer metrics


async def test_answers_are_counted_timed_and_split_into_stages(alice, answer_llm):
    sid = await mk(alice)
    done0 = sample("answers_total", outcome="done")
    ft0 = sample("answer_first_token_seconds_count")
    total0 = sample("answer_total_seconds_count")
    ctx0 = sample("answer_stage_seconds_count", stage="context")
    mft0 = sample("answer_stage_seconds_count", stage="model_first_token")
    ok0 = sample("provider_calls_total", provider="llm", operation="answer", outcome="ok")
    await alice.post(
        f"/api/sessions/{sid}/suggest", json={"question_text": "Why do you want to work here?"}
    )
    assert sample("answers_total", outcome="done") == done0 + 1
    assert sample("answer_first_token_seconds_count") == ft0 + 1
    assert sample("answer_total_seconds_count") == total0 + 1
    assert sample("answer_stage_seconds_count", stage="context") == ctx0 + 1
    assert sample("answer_stage_seconds_count", stage="model_first_token") == mft0 + 1
    assert (
        sample("provider_calls_total", provider="llm", operation="answer", outcome="ok") == ok0 + 1
    )


async def test_skips_repeats_and_errors_are_counted(alice, answer_llm):
    sid = await mk(alice)
    skip0, rep0, err0 = (sample("answers_total", outcome=o) for o in ("skip", "repeat", "error"))
    await alice.post(
        f"/api/sessions/{sid}/suggest", json={"question_text": "Mm-hm."}
    )  # prefiltered
    answer_llm.script = lambda m: ["NO_QUESTION"]
    await alice.post(
        f"/api/sessions/{sid}/suggest", json={"question_text": "Lovely weather we are having today"}
    )
    answer_llm.script = lambda m: [GOOD_OUTLINE]
    await alice.post(
        f"/api/sessions/{sid}/suggest", json={"question_text": "What is your biggest weakness?"}
    )
    await alice.post(
        f"/api/sessions/{sid}/suggest", json={"question_text": "What is your biggest weakness?"}
    )
    answer_llm.script = lambda m: [ProviderError("down")]
    await alice.post(
        f"/api/sessions/{sid}/suggest", json={"question_text": "Tell me about a failure?"}
    )
    assert sample("answers_total", outcome="skip") == skip0 + 2
    assert sample("answers_total", outcome="repeat") == rep0 + 1
    assert sample("answers_total", outcome="error") == err0 + 1


async def test_a_fallback_answer_is_counted_and_provider_errors_recorded(alice, answer_llm):
    sid = await mk(alice)
    fb0 = sample("answers_total", outcome="fallback")
    er0 = sample("provider_calls_total", provider="llm", operation="answer", outcome="error")
    answer_llm.script = lambda model: (
        [ProviderError("primary down")] if model is None else [GOOD_OUTLINE]
    )
    await alice.post(
        f"/api/sessions/{sid}/suggest", json={"question_text": "Why do you want to work here?"}
    )
    assert sample("answers_total", outcome="fallback") == fb0 + 1
    assert (
        sample("provider_calls_total", provider="llm", operation="answer", outcome="error")
        == er0 + 1
    )


async def test_metrics_never_contain_what_was_said_or_written(alice, answer_llm):
    sid = await mk(alice)
    marker = "ZEBRA-UNIQUE-PHRASE-9917"
    await alice.post(
        f"/api/sessions/{sid}/suggest", json={"question_text": f"Tell me about {marker}?"}
    )
    text = metrics.render().decode()
    assert marker not in text and "Launch project" not in text


# ---------------------------------------------------------- usage and spend


async def test_spend_follows_the_configured_prices(db, monkeypatch):
    s = Settings(
        price_stt_per_minute=0.60, price_llm_input_per_million=1.0, price_llm_output_per_million=2.0
    )  # type: ignore[call-arg]
    metrics.configure(s)
    try:
        from app.models import User as U

        user = U(email="m@example.com")
        db.add(user)
        await db.commit()
        repo = UsageMeterRepo(db, user.id)
        spend0 = sample("estimated_spend_usd_total")
        stt0 = sample("stt_audio_seconds_total")
        tok_in0 = sample("llm_tokens_total", direction="input")
        tok_out0 = sample("llm_tokens_total", direction="output")
        await repo.add_stt_seconds(60)  # a minute at $0.60
        await repo.add_tokens(1_000_000, 500_000)  # $1.00 + $1.00
        assert sample("stt_audio_seconds_total") == stt0 + 60
        assert sample("llm_tokens_total", direction="input") == tok_in0 + 1_000_000
        assert sample("llm_tokens_total", direction="output") == tok_out0 + 500_000
        assert sample("estimated_spend_usd_total") == pytest.approx(spend0 + 0.60 + 1.0 + 1.0)
    finally:
        metrics.configure(Settings())  # type: ignore[call-arg]


def test_zero_and_negative_usage_adds_nothing():
    before = sample("estimated_spend_usd_total")
    metrics.record_stt_seconds(0)
    metrics.record_stt_seconds(-5)
    metrics.record_tokens(0, 0)
    metrics.record_tokens(-1, -1)
    assert sample("estimated_spend_usd_total") == before


# -------------------------------------------------------- relay and research


async def test_open_sockets_are_gauged_and_closes_counted_by_code(alice, live_server, stt):
    import json

    import websockets

    s = (await alice.post("/api/sessions", json={"consent": True})).json()
    base_open = sample("audio_websockets_open")
    ok0 = sample("provider_calls_total", provider="stt", operation="open", outcome="ok")
    closes0 = sample("audio_websocket_closes_total", code="1000")
    ws = await websockets.connect(
        f"ws://{live_server}/api/sessions/{s['session_id']}/audio", origin="http://localhost:5173"
    )
    await ws.send(json.dumps({"type": "auth", "token": s["audio_token"]}))
    assert json.loads(await ws.recv())["type"] == "ready"
    assert sample("audio_websockets_open") == base_open + 1
    await ws.send(json.dumps({"type": "stop"}))
    async with asyncio.timeout(3):
        while sample("audio_websockets_open") != base_open:
            await asyncio.sleep(0.02)
    assert sample("provider_calls_total", provider="stt", operation="open", outcome="ok") == ok0 + 1
    assert sample("audio_websocket_closes_total", code="1000") == closes0 + 1


async def test_a_failed_transcription_open_is_counted(alice, live_server, stt):
    import json

    import websockets

    stt.fail_opens = 2
    s = (await alice.post("/api/sessions", json={"consent": True})).json()
    err0 = sample("provider_calls_total", provider="stt", operation="open", outcome="error")
    closes0 = sample("audio_websocket_closes_total", code="4500")
    ws = await websockets.connect(
        f"ws://{live_server}/api/sessions/{s['session_id']}/audio", origin="http://localhost:5173"
    )
    await ws.send(json.dumps({"type": "auth", "token": s["audio_token"]}))
    await asyncio.sleep(0.5)
    assert (
        sample("provider_calls_total", provider="stt", operation="open", outcome="error")
        == err0 + 2
    )
    assert sample("audio_websocket_closes_total", code="4500") == closes0 + 1


async def test_research_jobs_are_counted_by_outcome_and_timed(alice, runner):
    started0, ready0, failed0 = (
        sample("research_jobs_total", status=x) for x in ("started", "ready", "failed")
    )
    dur0 = sample("research_job_duration_seconds_count")
    await alice.post("/api/companies", json={"name": "Acme", "website_url": "https://acme.com/"})
    await runner.wait_idle()
    assert sample("research_jobs_total", status="started") == started0 + 1
    assert sample("research_jobs_total", status="ready") == ready0 + 1
    assert sample("research_job_duration_seconds_count") == dur0 + 1
    runner.fetcher.results.clear()  # nothing readable: the next job fails
    await alice.post("/api/companies", json={"name": "Bare", "website_url": "https://acme.com/"})
    await runner.wait_idle()
    assert sample("research_jobs_total", status="failed") == failed0 + 1


# ---------------------------------------------------------- loop and pool


async def test_the_monitor_reports_loop_lag_and_pool_use():
    count0 = sample("event_loop_lag_seconds_count")
    task = asyncio.create_task(metrics.monitor_loop(interval=0.05))
    await asyncio.sleep(0.3)
    task.cancel()
    assert sample("event_loop_lag_seconds_count") > count0  # it is sampling
    assert sample("db_pool_connections_max") >= 10  # pool_size + overflow, from settings


async def test_a_stall_is_recorded_even_if_nothing_scrapes_during_it():
    """A blocked loop (what the alert exists to catch) is remembered by the histogram: a gauge
    would have forgotten it by the next tick."""
    import time

    sum0 = sample("event_loop_lag_seconds_sum")
    over_100ms0 = sample("event_loop_lag_seconds_count") - sample(
        "event_loop_lag_seconds_bucket", le="0.1"
    )
    task = asyncio.create_task(metrics.monitor_loop(interval=0.05))
    await asyncio.sleep(0.1)
    time.sleep(0.4)  # something blocks the event loop
    await asyncio.sleep(0.3)  # many quiet ticks follow
    task.cancel()
    assert sample("event_loop_lag_seconds_sum") - sum0 > 0.3
    over_100ms = sample("event_loop_lag_seconds_count") - sample(
        "event_loop_lag_seconds_bucket", le="0.1"
    )
    assert over_100ms >= over_100ms0 + 1  # at least one tick was recorded as more than 100 ms late


# ----------------------------------------------------------- error tracking


def test_the_error_tracker_receives_no_content():
    event = {
        "message": "failed for user alice: 'I led the launch at Acme'",
        "request": {
            "url": "https://x/api/notes",
            "data": {"content": "secret notes"},
            "cookies": {"session": "abc"},
            "headers": {"authorization": "x"},
        },
        "user": {"email": "alice@example.com", "ip_address": "1.2.3.4"},
        "breadcrumbs": {"values": [{"message": "transcript line"}]},
        "extra": {"text": "what the partner said"},
        "logentry": {"message": "transcript line %s", "params": ["x"]},
        "contexts": {
            "runtime": {"name": "CPython"},
            "custom": {"notes": "n"},
            "trace": {"trace_id": "t"},
        },
        "exception": {
            "values": [
                {
                    "type": "ValueError",
                    "value": "bad text: I led the launch",
                    "stacktrace": {
                        "frames": [
                            {
                                "function": "save",
                                "vars": {"text": "secret"},
                                "pre_context": ["a"],
                                "context_line": "b",
                                "post_context": ["c"],
                                "lineno": 12,
                            }
                        ]
                    },
                }
            ]
        },
    }
    out = scrub_event(event)
    flat = repr(out)
    for secret in (
        "alice",
        "secret notes",
        "transcript line",
        "partner said",
        "I led the launch",
        "abc",
        "1.2.3.4",
    ):
        assert secret not in flat, secret
    exc = out["exception"]["values"][0]
    assert exc["type"] == "ValueError" and exc["value"] == ""  # the type stays, the message goes
    frame = exc["stacktrace"]["frames"][0]
    assert frame["function"] == "save" and frame["lineno"] == 12  # where it happened stays
    assert set(out["contexts"]) == {"runtime", "trace"}


def test_scrubbing_tolerates_sparse_events():
    assert scrub_event({}) is not None
    assert scrub_event({"exception": {"values": None}}) is not None
    assert (
        scrub_event({"exception": {"values": [{"type": "X"}]}})["exception"]["values"][0]["value"]
        == ""
    )


def test_sentry_is_off_without_a_dsn_and_safe_without_the_package():
    assert init_sentry(Settings(sentry_dsn="")) is False  # type: ignore[call-arg]
    # the SDK is an optional extra: a DSN without it must not crash the API
    assert init_sentry(Settings(sentry_dsn="https://k@o.ingest.sentry.io/1")) is False  # type: ignore[call-arg]


# ------------------------------------------------------------- circuit breaker


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def test_breaker_opens_after_five_failures_in_thirty_seconds_for_sixty():
    clock = Clock()
    b = CircuitBreaker(clock=clock)
    for _ in range(4):
        b.record_failure()
        clock.t += 1
    assert b.allow()  # four is not enough
    b.record_failure()
    assert not b.allow() and b.is_open
    clock.t += 59
    assert not b.allow()
    clock.t += 2
    assert b.allow()  # sixty seconds later it probes again


def test_failures_spread_over_more_than_thirty_seconds_do_not_trip_it():
    clock = Clock()
    b = CircuitBreaker(clock=clock)
    for _ in range(10):
        b.record_failure()
        clock.t += 8  # at most four fall inside any 30 s window
    assert b.allow()


def test_a_successful_probe_closes_it_and_a_failed_probe_keeps_it_open():
    clock = Clock()
    b = CircuitBreaker(clock=clock)
    for _ in range(5):
        b.record_failure()
    clock.t += 61
    assert b.allow()
    b.record_failure()  # the probe failed
    assert not b.allow()
    clock.t += 61
    b.record_success()
    assert b.allow() and not b.is_open
    for _ in range(4):
        b.record_failure()
    assert b.allow()  # the count started again from zero


async def test_a_sick_primary_model_is_bypassed_then_probed_again(alice, answer_llm, suggester):
    clock = Clock()
    suggester.breaker = CircuitBreaker(clock=clock)
    sid = await mk(alice)
    models: list[str | None] = []
    sick = {"on": True}

    def script(model):
        models.append(model)
        if model is None and sick["on"]:
            return [ProviderError("primary down")]
        return [GOOD_OUTLINE]

    answer_llm.script = script
    for i in range(5):  # five answers whose primary attempt fails, each rescued by the fallback
        await alice.post(
            f"/api/sessions/{sid}/suggest",
            json={"question_text": f"Question number {i} about teamwork?"},
        )
    assert models.count(None) == 5
    models.clear()
    r = await alice.post(
        f"/api/sessions/{sid}/suggest", json={"question_text": "Another question about leadership?"}
    )
    assert "event: done" in r.text
    assert (
        None not in models
    )  # the breaker is open: straight to the fallback model, no wasted attempt

    clock.t += 61
    sick["on"] = False
    models.clear()
    await alice.post(
        f"/api/sessions/{sid}/suggest",
        json={"question_text": "One more about conflict resolution?"},
    )
    assert models == [None]  # probed the primary again, it worked
    models.clear()
    await alice.post(
        f"/api/sessions/{sid}/suggest",
        json={"question_text": "And one about deadlines and delivery?"},
    )
    assert models == [None]  # closed again


# ---------------------------------------------------------------- alert rules


def test_every_alert_uses_only_metrics_the_api_exports():
    rules = yaml.safe_load((Path(__file__).parents[2] / "ops" / "alerts.yml").read_text())
    exported = {m.name for m in metrics.REGISTRY.collect()} | {
        m.name + "_total" for m in metrics.REGISTRY.collect()
    }
    words = {"rate", "sum", "by", "le", "histogram_quantile", "increase", "max_over_time", "up", "job",
             "stage", "outcome", "status", "provider", "operation", "route", "code", "direction"}  # fmt: skip
    seen = set()
    for group in rules["groups"]:
        for rule in group["rules"]:
            expr = re.sub(r'"[^"]*"', "", rule["expr"])  # drop label values
            expr = re.sub(r"\[[^\]]*\]", "", expr)  # drop range selectors such as [10m]
            for name in re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*", expr):
                if name in words or name.isdigit():
                    continue
                base = re.sub(r"_(bucket|count|sum)$", "", name)
                assert base in exported or name in exported, (
                    f"{rule['alert']} uses unknown metric {name}"
                )
                seen.add(base)
    assert {
        "answer_first_token_seconds",
        "provider_calls_total",
        "estimated_spend_usd_total",
    } <= seen


def test_every_alert_has_a_severity_summary_and_an_existing_runbook():
    root = Path(__file__).parents[2]
    rules = yaml.safe_load((root / "ops" / "alerts.yml").read_text())
    names = []
    for group in rules["groups"]:
        for rule in group["rules"]:
            names.append(rule["alert"])
            assert rule["labels"]["severity"] in {"page", "ticket"}
            assert rule["annotations"]["summary"]
            runbook = rule["annotations"]["runbook"]
            assert (root / runbook).exists(), f"{rule['alert']} points at missing {runbook}"
    assert len(names) == len(set(names))
    for required in ("AnswerLatencyMedianHigh", "AnswerLatencyP95High", "ProviderErrorRateHigh",
                     "ResearchFailuresHigh", "DailySpendNearBudget", "EventLoopLagHigh",
                     "DbPoolSaturated", "Http5xxRateHigh"):  # fmt: skip
        assert required in names  # the alerts the design document asks for
