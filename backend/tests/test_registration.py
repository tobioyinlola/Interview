"""Signing in is for people who have an account. An emailed link or Google for an address with no
account is told to sign up, and nothing is sent or created."""

from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.deps import get_google
from app.models import User
from app.services.google_oauth import GoogleOAuth

from .test_google_auth import FakeGoogle, google_settings


async def users(engine) -> int:  # type: ignore[no-untyped-def]
    async with async_sessionmaker(engine)() as s:
        return int(await s.scalar(select(func.count(User.id))) or 0)


@pytest.fixture
def closed(app, settings):  # type: ignore[no-untyped-def]
    """The real default: no account is made by an emailed link or by Google's sign-in."""
    settings.open_link_signup = False
    app.dependency_overrides[get_settings] = lambda: settings
    return settings


async def test_an_emailed_link_for_an_unknown_address_says_to_sign_up(
    new_client, closed, sender, engine
) -> None:
    async with new_client() as c:
        r = await c.post("/api/auth/request-link", json={"email": "nobody@example.com"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_registered"
    assert "sign up" in r.json()["error"]["message"].lower()
    assert sender.messages == [] and await users(engine) == 0


async def test_an_emailed_link_still_goes_to_someone_who_has_an_account(
    new_client, closed, sender, engine
) -> None:
    async with new_client() as c:  # make the account the proper way: sign up, open the link
        r = await c.post(
            "/api/auth/signup",
            json={
                "email": "ada@example.com",
                "password": "Correct-horse-9battery",
                "full_name": "Ada Lovelace",
            },
        )
        assert r.status_code == 202
        v = await c.post("/api/auth/verify", json={"token": sender.token_for("ada@example.com")})
        assert v.status_code == 200
    sender.messages.clear()
    async with new_client() as c:
        r = await c.post("/api/auth/request-link", json={"email": "Ada@Example.com"})
    assert r.status_code == 202
    assert len(sender.messages) == 1 and sender.messages[0].to == "ada@example.com"


async def test_google_for_an_unknown_account_sends_them_to_sign_up_and_makes_nothing(
    new_client, app, closed, engine
) -> None:
    fake = FakeGoogle()
    cfg = google_settings(open_link_signup=False)
    app.dependency_overrides[get_settings] = lambda: cfg
    app.dependency_overrides[get_google] = lambda: GoogleOAuth(
        cfg, transport=httpx.MockTransport(fake.handler)
    )
    async with new_client() as c:
        for mode in ("signin", None):  # the sign-in page, and a start with no mode at all
            r = await c.get("/api/auth/google/start", params={"mode": mode} if mode else {})
            q = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
            fake.nonce = q["nonce"]
            r = await c.get("/api/auth/google/callback", params={"code": "x", "state": q["state"]})
            assert r.status_code == 303
            assert r.headers["location"].endswith("/login?error=not_registered")
            assert (await c.get("/api/me")).status_code == 401
    assert await users(engine) == 0


async def test_google_on_the_sign_up_page_still_creates_the_account(
    new_client, app, closed, engine
) -> None:
    fake = FakeGoogle()
    cfg = google_settings(open_link_signup=False)
    app.dependency_overrides[get_settings] = lambda: cfg
    app.dependency_overrides[get_google] = lambda: GoogleOAuth(
        cfg, transport=httpx.MockTransport(fake.handler)
    )
    async with new_client() as c:
        r = await c.get("/api/auth/google/start", params={"mode": "signup"})
        q = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
        fake.nonce = q["nonce"]
        r = await c.get("/api/auth/google/callback", params={"code": "x", "state": q["state"]})
        assert r.headers["location"].endswith("/dashboard")
        assert (await c.get("/api/me")).status_code == 200
    assert await users(engine) == 1


async def test_google_signs_an_existing_account_in_from_the_sign_in_page(
    new_client, app, closed, engine
) -> None:
    fake = FakeGoogle()
    cfg = google_settings(open_link_signup=False)
    app.dependency_overrides[get_settings] = lambda: cfg
    app.dependency_overrides[get_google] = lambda: GoogleOAuth(
        cfg, transport=httpx.MockTransport(fake.handler)
    )
    async with new_client() as c:  # first time: sign up with Google
        r = await c.get("/api/auth/google/start", params={"mode": "signup"})
        q = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
        fake.nonce = q["nonce"]
        await c.get("/api/auth/google/callback", params={"code": "x", "state": q["state"]})
    async with new_client() as c:  # later: sign in with Google
        r = await c.get("/api/auth/google/start", params={"mode": "signin"})
        q = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
        fake.nonce = q["nonce"]
        r = await c.get("/api/auth/google/callback", params={"code": "y", "state": q["state"]})
        assert r.headers["location"].endswith("/dashboard")
        assert (await c.get("/api/me")).status_code == 200
    assert await users(engine) == 1
