import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.config import Settings
from app.hardening import RateLimiter, assert_safe, validate_settings
from app.main import create_app
from tests.conftest import TEST_DB

GOOD = dict(
    environment="production",
    cookie_secret="x" * 40,
    web_origin="https://app.example.com",
    database_url="postgresql+asyncpg://app:s3cretpw@db.internal:5432/meet",
    openai_api_key="sk-live-abc",
)


def cfg(**over) -> Settings:
    return Settings(**{**GOOD, **over})  # type: ignore[arg-type]


# --------------------------------------------------------- configuration checks


def test_a_correct_production_configuration_is_accepted():
    assert validate_settings(cfg()) == []
    assert (
        validate_settings(cfg(environment="staging", openai_api_key="")) == []
    )  # staging may lack a key


@pytest.mark.parametrize(
    "over,fragment",
    [
        ({"cookie_secret": "dev-only-change-me"}, "COOKIE_SECRET"),
        ({"cookie_secret": "short"}, "COOKIE_SECRET"),
        ({"cookie_secret": ""}, "COOKIE_SECRET"),
        ({"web_origin": "http://app.example.com"}, "https://"),
        ({"web_origin": "http://localhost:5173"}, "https://"),
        ({"database_url": "postgresql+asyncpg://postgres:postgres@db/meet"}, "default postgres"),
        ({"use_fake_providers": True}, "USE_FAKE_PROVIDERS"),
        ({"openai_api_key": ""}, "OPENAI_API_KEY"),
    ],
)
def test_each_unsafe_setting_is_reported_for_production(over, fragment):
    problems = validate_settings(cfg(**over))
    assert any(fragment in p for p in problems), problems


def test_staging_is_held_to_the_same_rules_except_the_openai_key():
    assert validate_settings(cfg(environment="staging", cookie_secret="dev-only-change-me"))
    assert validate_settings(cfg(environment="staging", use_fake_providers=True))


def test_local_is_never_blocked_and_unknown_environments_are():
    assert validate_settings(Settings(environment="local", use_fake_providers=True)) == []  # type: ignore[call-arg]
    assert "ENVIRONMENT must be one of" in validate_settings(cfg(environment="prod"))[0]


def test_every_problem_is_listed_at_once_and_none_leak_secret_values():
    bad = cfg(cookie_secret="dev-only-change-me", web_origin="http://x", openai_api_key="")
    with pytest.raises(RuntimeError) as e:
        assert_safe(bad)
    msg = str(e.value)
    assert msg.count("\n- ") == 3
    assert "dev-only-change-me" not in msg  # names the setting, never prints its value


async def test_the_app_refuses_to_start_with_an_unsafe_production_config(monkeypatch):
    monkeypatch.setattr("app.main.get_settings", lambda: cfg(cookie_secret="dev-only-change-me"))
    app = create_app()
    with pytest.raises(RuntimeError, match="Unsafe configuration"):
        async with app.router.lifespan_context(app):
            pass


# ------------------------------------------------------------ helpers for HTTP


@pytest.fixture(autouse=True)
async def fresh_global_engine(monkeypatch, engine):  # `engine` gives a clean schema each test
    """Routes that use the real database dependency share one module-level engine. Give each test
    its own (the event loop changes per test) and dispose it afterwards."""
    from app import db as dbmod

    monkeypatch.setattr(dbmod, "_engine", None)
    monkeypatch.setattr(dbmod, "_sessionmaker", None)
    yield
    if dbmod._engine is not None:
        await dbmod._engine.dispose()


def make_client(monkeypatch, **over) -> httpx.AsyncClient:
    settings = Settings(**{"environment": "local", "database_url": TEST_DB, **over})  # type: ignore[arg-type]
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    monkeypatch.setattr("app.db.get_settings", lambda: settings)  # the engine reads it here
    app = create_app()
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"x-requested-with": "meet-practice"},
    )


# -------------------------------------------------------------- security headers


async def test_security_headers_are_on_every_response(monkeypatch):
    async with make_client(monkeypatch) as c:
        for path in ("/healthz", "/api/me", "/api/nope"):
            r = await c.get(path)
            h = r.headers
            assert h["x-content-type-options"] == "nosniff", path
            assert h["x-frame-options"] == "DENY"
            assert h["referrer-policy"] == "no-referrer"
            assert "default-src 'none'" in h["content-security-policy"]
            assert "frame-ancestors 'none'" in h["content-security-policy"]


async def test_private_api_responses_are_never_cached(monkeypatch):
    async with make_client(monkeypatch) as c:
        assert (await c.get("/api/me")).headers["cache-control"] == "no-store"
        assert "cache-control" not in (await c.get("/healthz")).headers


async def test_hsts_only_outside_local(monkeypatch):
    async with make_client(monkeypatch) as c:
        assert "strict-transport-security" not in (await c.get("/healthz")).headers
    async with make_client(monkeypatch, **{**GOOD, "database_url": TEST_DB}) as c:
        assert "max-age=31536000" in (await c.get("/healthz")).headers["strict-transport-security"]


# ---------------------------------------------------------------- body limits


async def test_a_declared_oversized_body_is_rejected_before_anything_else_runs(monkeypatch):
    async with make_client(monkeypatch) as c:
        r = await c.put(
            "/api/notes", content=b"x" * 1_000_001, headers={"content-type": "application/json"}
        )
    assert r.status_code == 413
    err = r.json()["error"]
    assert err["code"] == "body_too_large" and err["request_id"]


async def test_a_streamed_body_with_no_length_is_cut_off_at_the_limit(monkeypatch):
    async def chunks():
        for _ in range(30):
            yield b"x" * 50_000  # 1.5 MB, sent chunked

    async with make_client(monkeypatch) as c:
        r = await c.put(
            "/api/notes", content=chunks(), headers={"content-type": "application/json"}
        )
    assert r.status_code == 413 and r.json()["error"]["code"] == "body_too_large"


async def test_normal_sized_requests_are_untouched(monkeypatch):
    async with make_client(monkeypatch) as c:
        r = await c.put("/api/notes", json={"role": "x", "content": "y" * 20_000})
    assert r.status_code == 401  # reached auth: the limit did not interfere


async def test_the_audio_segment_route_gets_its_own_larger_limit(monkeypatch):
    big = b"\x00" * (1_500_000)  # over the default 1 MB, under the audio limit
    async with make_client(monkeypatch) as c:
        ok = await c.post("/api/sessions/00000000-0000-0000-0000-000000000000/segment", content=big)
        too_big = await c.post(
            "/api/sessions/00000000-0000-0000-0000-000000000000/segment",
            content=b"\x00" * 2_200_000,
        )
    assert ok.status_code == 401  # passed the limit, stopped at sign-in
    assert too_big.status_code == 413


async def test_get_requests_have_no_body_limit(monkeypatch):
    async with make_client(monkeypatch, max_body_bytes=10) as c:
        assert (await c.get("/api/me")).status_code == 401


# ---------------------------------------------------------------- rate limiting


def test_rate_limiter_allows_up_to_the_limit_then_says_how_long_to_wait():
    t = {"now": 100.0}
    lim = RateLimiter(clock=lambda: t["now"])
    assert [lim.check("k", 3) for _ in range(3)] == [None, None, None]
    wait = lim.check("k", 3)
    assert wait is not None and 59 <= wait <= 60
    t["now"] += 30
    wait2 = lim.check("k", 3)
    assert wait2 is not None and 29 <= wait2 <= 30  # the window slides, it does not reset
    t["now"] += 31
    assert lim.check("k", 3) is None  # the oldest hits have aged out


def test_rate_limiter_keys_are_independent_and_memory_is_bounded():
    t = {"now": 0.0}
    lim = RateLimiter(clock=lambda: t["now"])
    assert lim.check("a", 1) is None and lim.check("a", 1) is not None
    assert lim.check("b", 1) is None
    for i in range(50_001):
        lim.check(f"flood{i}", 1)
    t["now"] += 120
    lim.check("trigger", 1)
    assert len(lim._hits) < 50_001


async def test_sign_in_endpoints_have_a_stricter_limit_with_retry_after(monkeypatch):
    async with make_client(monkeypatch, rate_limit_auth_per_minute=3) as c:
        codes = [
            (
                await c.post("/api/auth/request-link", json={"email": f"u{i}@example.com"})
            ).status_code
            for i in range(5)
        ]
        r = await c.post("/api/auth/request-link", json={"email": "z@example.com"})
    assert codes == [202, 202, 202, 429, 429]
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1
    assert r.json()["error"]["code"] == "rate_limited"


async def test_the_general_limit_applies_to_the_rest_of_the_api(monkeypatch):
    async with make_client(monkeypatch, rate_limit_per_minute=4) as c:
        codes = [(await c.get("/api/me")).status_code for _ in range(6)]
    assert codes == [401, 401, 401, 401, 429, 429]


async def test_health_checks_and_non_api_paths_are_never_limited(monkeypatch):
    async with make_client(monkeypatch, rate_limit_per_minute=1, rate_limit_auth_per_minute=1) as c:
        for _ in range(10):
            assert (await c.get("/healthz")).status_code == 200


async def test_forwarded_headers_are_ignored_unless_a_proxy_is_trusted(monkeypatch):
    async with make_client(monkeypatch, rate_limit_per_minute=2) as c:
        codes = [
            (await c.get("/api/me", headers={"x-forwarded-for": f"10.0.0.{i}"})).status_code
            for i in range(4)
        ]
    assert codes == [401, 401, 429, 429]  # spoofing the header does not buy a fresh allowance


async def test_behind_a_trusted_proxy_each_real_client_gets_its_own_allowance(monkeypatch):
    async with make_client(monkeypatch, rate_limit_per_minute=2, trust_proxy_headers=True) as c:
        a = [
            (await c.get("/api/me", headers={"x-forwarded-for": "1.1.1.1, 10.0.0.1"})).status_code
            for _ in range(3)
        ]
        b = (await c.get("/api/me", headers={"x-forwarded-for": "2.2.2.2"})).status_code
    assert a == [401, 401, 429] and b == 401


async def test_rate_limit_rejections_still_carry_cors_and_a_request_id(monkeypatch):
    async with make_client(monkeypatch, rate_limit_per_minute=1) as c:
        await c.get("/api/me")
        r = await c.get("/api/me", headers={"origin": "http://localhost:5173"})
    assert r.status_code == 429
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert r.headers["x-request-id"]


# --------------------------------------------------------- database timeout


async def test_a_runaway_query_is_cancelled_by_the_statement_timeout(monkeypatch):
    import os

    from app import db as dbmod

    url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/meetpractice_test",
    )
    s = Settings(database_url=url, db_statement_timeout_ms=100)  # type: ignore[arg-type]
    monkeypatch.setattr(dbmod, "get_settings", lambda: s)
    monkeypatch.setattr(dbmod, "_engine", None)
    monkeypatch.setattr(dbmod, "_sessionmaker", None)
    engine = dbmod.get_engine()
    try:
        async with engine.connect() as conn:
            assert (await conn.execute(text("select 1"))).scalar() == 1  # normal queries are fine
            with pytest.raises(DBAPIError) as e:
                await conn.execute(text("select pg_sleep(1)"))
            assert "statement timeout" in str(e.value).lower()
    finally:
        await engine.dispose()
