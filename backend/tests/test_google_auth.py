import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import func, select

from app.config import Settings, get_settings
from app.deps import get_google
from app.hardening import validate_settings
from app.models import User
from app.services import google_oauth
from app.services.google_oauth import GoogleOAuth

CLIENT_ID = "client-123.apps.googleusercontent.com"


def google_settings(**over) -> Settings:  # type: ignore[no-untyped-def]
    return Settings(  # type: ignore[call-overload,no-any-return]
        environment="local",
        cookie_secret="test-secret",
        google_client_id=CLIENT_ID,
        google_client_secret="shh",
        api_public_url="https://api.example.com",
        **over,
    )


def id_token(claims: dict) -> str:  # type: ignore[type-arg]
    body = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return f"header.{body}.sig"


class FakeGoogle:
    """Stands in for Google's token endpoint. `claims` can be changed per test."""

    def __init__(self) -> None:
        self.requests: list[dict[str, str]] = []
        self.nonce = ""
        self.email = "Rahman@Example.com"
        self.override: dict = {}  # type: ignore[type-arg]
        self.status = 200

    def handler(self, request: httpx.Request) -> httpx.Response:
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        self.requests.append(form)
        if self.status != 200:
            return httpx.Response(self.status, json={"error": "invalid_grant"})
        claims = {
            "iss": "https://accounts.google.com",
            "aud": CLIENT_ID,
            "exp": int(time.time()) + 300,
            "nonce": self.nonce,
            "email": self.email,
            "email_verified": True,
        }
        claims.update(self.override)
        claims = {k: v for k, v in claims.items() if v is not None}
        return httpx.Response(200, json={"id_token": id_token(claims)})


@pytest.fixture
def google(app) -> FakeGoogle:  # type: ignore[no-untyped-def]
    fake = FakeGoogle()
    cfg = google_settings()
    app.dependency_overrides[get_settings] = lambda: cfg
    app.dependency_overrides[get_google] = lambda: GoogleOAuth(
        cfg, transport=httpx.MockTransport(fake.handler)
    )
    return fake


async def begin(c: httpx.AsyncClient, google: FakeGoogle) -> dict[str, str]:
    r = await c.get("/api/auth/google/start")
    assert r.status_code == 302, r.text
    query = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
    google.nonce = query["nonce"]
    return query


async def count_users(engine) -> int:  # type: ignore[no-untyped-def]
    from sqlalchemy.ext.asyncio import async_sessionmaker

    async with async_sessionmaker(engine)() as s:
        return int(await s.scalar(select(func.count(User.id))) or 0)


def failed(r: httpx.Response) -> bool:
    return r.status_code == 303 and r.headers["location"].endswith("/login?error=google_failed")


# ------------------------------------------------------------------ availability


async def test_providers_reports_whether_google_is_configured(new_client, app) -> None:
    async with new_client() as c:
        assert (await c.get("/api/auth/providers")).json() == {"google": False}
        cfg = google_settings()
        app.dependency_overrides[get_google] = lambda: GoogleOAuth(cfg)
        assert (await c.get("/api/auth/providers")).json() == {"google": True}


async def test_start_is_not_found_when_google_is_not_configured(new_client) -> None:
    async with new_client() as c:
        r = await c.get("/api/auth/google/start")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "google_not_configured"


# ------------------------------------------------------------------ the start of the flow


async def test_start_sends_the_browser_to_google_with_state_nonce_and_pkce(
    new_client, google
) -> None:
    async with new_client() as c:
        r = await c.get("/api/auth/google/start")
        q = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
    assert r.headers["location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert q["client_id"] == CLIENT_ID
    assert q["redirect_uri"] == "https://api.example.com/api/auth/google/callback"
    assert q["response_type"] == "code" and q["scope"] == "openid email"
    assert q["code_challenge_method"] == "S256"
    assert len(q["state"]) >= 32 and len(q["nonce"]) >= 32
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "path=/api/auth/google" in cookie
    assert "client_secret" not in r.headers["location"] and "shh" not in r.headers["location"]


async def test_every_start_uses_fresh_random_values(new_client, google) -> None:
    async with new_client() as c:
        a, b = await begin(c, google), await begin(c, google)
    assert a["state"] != b["state"] and a["nonce"] != b["nonce"]
    assert a["code_challenge"] != b["code_challenge"]


# ------------------------------------------------------------------ the happy path


async def test_callback_signs_the_user_in_and_goes_to_the_dashboard(new_client, google) -> None:
    async with new_client() as c:
        q = await begin(c, google)
        r = await c.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"]})
        assert r.status_code == 303 and r.headers["location"].endswith("/dashboard")
        assert "httponly" in r.headers["set-cookie"].lower()
        me = await c.get("/api/me")
    assert me.status_code == 200 and me.json()["email"] == "rahman@example.com"  # normalised


async def test_pkce_verifier_and_client_secret_reach_google_and_match_the_challenge(
    new_client, google
) -> None:
    async with new_client() as c:
        q = await begin(c, google)
        await c.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"]})
    sent = google.requests[0]
    assert sent["code"] == "abc" and sent["grant_type"] == "authorization_code"
    assert sent["client_secret"] == "shh" and sent["client_id"] == CLIENT_ID
    digest = hashlib.sha256(sent["code_verifier"].encode()).digest()
    assert base64.urlsafe_b64encode(digest).rstrip(b"=").decode() == q["code_challenge"]


async def test_the_same_email_is_the_same_account_whichever_way_it_signs_in(
    new_client, google, sign_in, engine
) -> None:
    async with new_client() as c:
        await sign_in(c, "rahman@example.com")  # first via email link
        first = (await c.get("/api/me")).json()["id"]
    async with new_client() as c2:
        q = await begin(c2, google)
        await c2.get("/api/auth/google/callback", params={"code": "x", "state": q["state"]})
        second = (await c2.get("/api/me")).json()["id"]
        q = await begin(c2, google)
        await c2.get("/api/auth/google/callback", params={"code": "y", "state": q["state"]})
    assert first == second
    assert await count_users(engine) == 1


# ------------------------------------------------------------------ refusals


async def no_session(c: httpx.AsyncClient) -> bool:
    return (await c.get("/api/me")).status_code == 401


async def test_a_state_that_does_not_match_this_browser_is_refused(new_client, google) -> None:
    async with new_client() as c:
        await begin(c, google)
        r = await c.get("/api/auth/google/callback", params={"code": "abc", "state": "forged"})
        assert failed(r) and await no_session(c)
    assert google.requests == []  # never even asked Google


async def test_a_callback_from_another_browser_is_refused(new_client, google) -> None:
    async with new_client() as victim, new_client() as attacker:
        q = await begin(attacker, google)  # attacker starts a flow and tricks the victim into it
        r = await victim.get(
            "/api/auth/google/callback", params={"code": "abc", "state": q["state"]}
        )
        assert failed(r) and await no_session(victim)


async def test_a_tampered_or_expired_state_cookie_is_refused(
    new_client, google, monkeypatch
) -> None:
    async with new_client() as c:
        q = await begin(c, google)
        value = c.cookies.get("oauth_state") or ""
        body, sig = value.rsplit(".", 1)
        c.cookies.delete("oauth_state", path="/api/auth/google")
        c.cookies.set("oauth_state", f"{body}.{sig[:-2]}AA", path="/api/auth/google")
        r = await c.get("/api/auth/google/callback", params={"code": "a", "state": q["state"]})
        assert failed(r)
    monkeypatch.setattr(google_oauth, "HANDSHAKE_TTL", -1)
    async with new_client() as c:
        q = await begin(c, google)
        r = await c.get("/api/auth/google/callback", params={"code": "a", "state": q["state"]})
        assert failed(r) and await no_session(c)


@pytest.mark.parametrize(
    "override",
    [
        {"aud": "someone-elses-client"},
        {"aud": ["a", "b"]},
        {"iss": "https://evil.example.com"},
        {"exp": 1},
        {"exp": None},
        {"nonce": "replayed-nonce"},
        {"nonce": None},
        {"email_verified": False},
        {"email_verified": "false"},
        {"email_verified": None},
        {"email": None},
    ],
)
async def test_a_bad_id_token_is_refused(new_client, google, override) -> None:  # type: ignore[no-untyped-def]
    google.override = override
    async with new_client() as c:
        q = await begin(c, google)
        r = await c.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"]})
        assert failed(r) and await no_session(c)


async def test_the_second_issuer_spelling_and_string_verified_flag_are_accepted(
    new_client, google
) -> None:
    google.override = {
        "iss": "accounts.google.com",
        "aud": [CLIENT_ID, "other"],
        "email_verified": "true",
    }
    async with new_client() as c:
        q = await begin(c, google)
        r = await c.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"]})
        assert r.headers["location"].endswith("/dashboard")


async def test_google_errors_never_sign_anyone_in(new_client, google) -> None:
    google.status = 400
    async with new_client() as c:
        q = await begin(c, google)
        r = await c.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"]})
        assert failed(r) and await no_session(c)


async def test_a_network_failure_talking_to_google_is_refused(new_client, app) -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    cfg = google_settings()
    app.dependency_overrides[get_settings] = lambda: cfg
    app.dependency_overrides[get_google] = lambda: GoogleOAuth(cfg, httpx.MockTransport(boom))
    async with new_client() as c:
        r0 = await c.get("/api/auth/google/start")
        state = parse_qs(urlparse(r0.headers["location"]).query)["state"][0]
        r = await c.get("/api/auth/google/callback", params={"code": "abc", "state": state})
        assert failed(r)


async def test_denying_the_google_prompt_returns_to_login_with_a_message_code(
    new_client, google
) -> None:
    async with new_client() as c:
        await begin(c, google)
        r = await c.get("/api/auth/google/callback", params={"error": "access_denied"})
    assert r.status_code == 303 and r.headers["location"].endswith("/login?error=google_cancelled")


async def test_the_state_is_single_use(new_client, google) -> None:
    async with new_client() as c:
        q = await begin(c, google)
        ok = await c.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"]})
        assert ok.headers["location"].endswith("/dashboard")
        assert (
            "oauth_state" in ok.headers["set-cookie"]
            and "max-age=0" in ok.headers["set-cookie"].lower()
        )
        await c.post("/api/auth/logout")
        replay = await c.get(
            "/api/auth/google/callback", params={"code": "abc", "state": q["state"]}
        )
        assert failed(replay) and await no_session(c)


async def test_refusals_log_a_reason_but_never_the_email_or_token(
    new_client, google, caplog: pytest.LogCaptureFixture
) -> None:
    google.override = {"email_verified": False}
    async with new_client() as c:
        q = await begin(c, google)
        await c.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"]})
    text = " ".join(r.getMessage() + str(getattr(r, "fields", "")) for r in caplog.records)
    assert "not verified" in text
    assert "rahman@example.com" not in text.lower() and "header." not in text


# ------------------------------------------------------------------ configuration


def test_the_google_endpoints_cannot_be_redirected_outside_local() -> None:
    base = dict(
        environment="production",
        cookie_secret="x" * 40,
        web_origin="https://app.example.com",
        database_url="postgresql+asyncpg://u:p@db/x",
        openai_api_key="sk-x",
        resend_api_key="re_x",
        email_from="a@b.com",
    )
    evil = Settings(**base, google_token_url="https://evil.example.com/token")  # type: ignore[arg-type]
    assert any("local tests only" in p for p in validate_settings(evil))
    assert validate_settings(Settings(**base)) == []  # type: ignore[arg-type]


def test_google_settings_must_be_complete_and_https_outside_local() -> None:
    base = dict(
        environment="production",
        cookie_secret="x" * 40,
        web_origin="https://app.example.com",
        database_url="postgresql+asyncpg://u:p@db/x",
        openai_api_key="sk-x",
        resend_api_key="re_x",
        email_from="a@b.com",
    )
    assert validate_settings(Settings(**base)) == []  # type: ignore[arg-type]
    half = validate_settings(Settings(**base, google_client_id="id"))  # type: ignore[arg-type]
    assert any("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" in p for p in half)
    insecure = validate_settings(
        Settings(  # type: ignore[arg-type]
            **base,
            google_client_id="id",
            google_client_secret="s",
            api_public_url="http://api.example.com",
        )
    )
    assert any("API_PUBLIC_URL" in p for p in insecure)
    ok = Settings(  # type: ignore[arg-type]
        **base,
        google_client_id="id",
        google_client_secret="s",
        api_public_url="https://api.example.com",
    )
    assert validate_settings(ok) == []


def test_web_and_api_must_share_a_site_or_the_login_cookie_is_dropped() -> None:
    from app.hardening import same_site

    assert same_site("https://app.example.com", "https://api.example.com")
    assert same_site("https://example.com", "https://api.example.com")
    assert same_site("http://localhost:5173", "http://localhost:8000")
    assert not same_site("https://web-prod.up.railway.app", "https://api-prod.up.railway.app")
    assert not same_site("https://a.vercel.app", "https://b.vercel.app")
    assert not same_site("https://app.example.com", "https://api.other.com")
    base = dict(
        environment="production",
        cookie_secret="x" * 40,
        database_url="postgresql+asyncpg://u:p@db/x",
        openai_api_key="sk-x",
        resend_api_key="re_x",
        email_from="a@b.com",
    )
    bad = Settings(  # type: ignore[arg-type]
        **base,
        web_origin="https://web-prod.up.railway.app",
        api_public_url="https://api-prod.up.railway.app",
    )
    assert any("same site" in p for p in validate_settings(bad))
    good = Settings(  # type: ignore[arg-type]
        **base, web_origin="https://app.example.com", api_public_url="https://api.example.com"
    )
    assert validate_settings(good) == []
