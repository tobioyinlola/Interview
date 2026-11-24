"""Google sign-in for the installed apps: the system browser signs in, then hands the app a
one-time code that only works with the secret the app made before leaving."""

import base64
import hashlib
import re
from urllib.parse import parse_qs, urlparse

import httpx

from tests.test_google_auth import FakeGoogle, google  # noqa: F401  (the fixture)


def pair() -> tuple[str, str]:
    """What the app does: a random secret, and the hash of it that it sends ahead."""
    verifier = base64.urlsafe_b64encode(hashlib.sha256(b"seed").digest() * 2).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    return verifier, challenge.decode()


async def start_app(c: httpx.AsyncClient, google: FakeGoogle, challenge: str) -> dict[str, str]:  # noqa: F811
    r = await c.get("/api/auth/google/start", params={"app": "1", "challenge": challenge})
    assert r.status_code == 302, r.text
    q = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
    google.nonce = q["nonce"]
    return q


def handoff(r: httpx.Response) -> dict[str, str]:
    """The result the page passes to the app: the query of its interviewmeet:// link."""
    assert r.status_code == 200 and "text/html" in r.headers["content-type"], r.text
    m = re.search(r'href="(interviewmeet://auth\?[^"]+)"', r.text)
    assert m, r.text
    return {k: v[0] for k, v in parse_qs(urlparse(m.group(1).replace("&amp;", "&")).query).items()}


async def test_the_app_gets_a_code_not_a_cookie_and_swaps_it_for_a_session(
    new_client,
    google,  # noqa: F811
) -> None:
    verifier, challenge = pair()
    async with new_client() as browser:  # the system browser
        q = await start_app(browser, google, challenge)
        r = await browser.get(
            "/api/auth/google/callback", params={"code": "abc", "state": q["state"]}
        )
        assert "set-cookie" not in r.headers or "session" not in r.headers["set-cookie"].lower()
        code = handoff(r)["code"]
        assert (await browser.get("/api/me")).status_code == 401  # the browser stays signed out
    async with new_client() as app:  # the app's own web view
        done = await app.post("/api/auth/app-exchange", json={"code": code, "verifier": verifier})
        assert done.status_code == 200
        assert "httponly" in done.headers["set-cookie"].lower()
        me = await app.get("/api/me")
    assert me.status_code == 200 and me.json()["email"] == "rahman@example.com"


async def test_a_code_works_once(new_client, google) -> None:  # noqa: F811
    verifier, challenge = pair()
    async with new_client() as c:
        q = await start_app(c, google, challenge)
        code = handoff(
            await c.get("/api/auth/google/callback", params={"code": "a", "state": q["state"]})
        )["code"]
    async with new_client() as app:
        body = {"code": code, "verifier": verifier}
        assert (await app.post("/api/auth/app-exchange", json=body)).status_code == 200
    async with new_client() as other:
        again = await other.post("/api/auth/app-exchange", json=body)
    assert again.status_code == 400 and again.json()["error"]["code"] == "invalid_code"


async def test_a_stolen_code_is_useless_without_the_apps_secret(new_client, google) -> None:  # noqa: F811
    verifier, challenge = pair()
    async with new_client() as c:
        q = await start_app(c, google, challenge)
        code = handoff(
            await c.get("/api/auth/google/callback", params={"code": "a", "state": q["state"]})
        )["code"]
    thief_secret = base64.urlsafe_b64encode(b"x" * 48).rstrip(b"=").decode()
    async with new_client() as thief:
        r = await thief.post(
            "/api/auth/app-exchange", json={"code": code, "verifier": thief_secret}
        )
        assert r.status_code == 400
        assert (await thief.get("/api/me")).status_code == 401
    # the wrong guess did not burn the code: the real app can still use it
    async with new_client() as app:
        ok = await app.post("/api/auth/app-exchange", json={"code": code, "verifier": verifier})
    assert ok.status_code == 200


async def test_an_expired_code_is_refused(new_client, google, engine) -> None:  # noqa: F811
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.models import AppLoginCode

    verifier, challenge = pair()
    async with new_client() as c:
        q = await start_app(c, google, challenge)
        code = handoff(
            await c.get("/api/auth/google/callback", params={"code": "a", "state": q["state"]})
        )["code"]
    async with async_sessionmaker(engine)() as s:
        await s.execute(update(AppLoginCode).values(expires_at=datetime.now(UTC) - timedelta(1)))
        await s.commit()
    async with new_client() as app:
        r = await app.post("/api/auth/app-exchange", json={"code": code, "verifier": verifier})
    assert r.status_code == 400


async def test_start_for_an_app_needs_a_proper_challenge(new_client, google) -> None:  # noqa: F811
    async with new_client() as c:
        for bad in ("", "short", "!" * 43):
            r = await c.get("/api/auth/google/start", params={"app": "1", "challenge": bad})
            assert r.status_code == 400
        assert (await c.get("/api/auth/google/start", params={"app": "1"})).status_code == 400


async def test_a_google_failure_tells_the_waiting_app(new_client, google) -> None:  # noqa: F811
    _, challenge = pair()
    async with new_client() as c:
        await start_app(c, google, challenge)
        r = await c.get("/api/auth/google/callback", params={"code": "a", "state": "forged"})
    assert handoff(r) == {"error": "google_failed"}


async def test_the_normal_web_sign_in_is_unchanged(new_client, google) -> None:  # noqa: F811
    async with new_client() as c:
        r = await c.get("/api/auth/google/start")
        q = {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).query).items()}
        google.nonce = q["nonce"]
        done = await c.get("/api/auth/google/callback", params={"code": "a", "state": q["state"]})
        assert done.status_code == 303 and done.headers["location"].endswith("/dashboard")
        assert (await c.get("/api/me")).status_code == 200


async def test_a_malformed_exchange_is_rejected(new_client) -> None:
    async with new_client() as c:
        r = await c.post("/api/auth/app-exchange", json={"code": "x", "verifier": "short"})
    assert r.status_code == 422


# ----------------------------------------------------------- emailed links asked for by an app


def sender(app):  # type: ignore[no-untyped-def]
    from app.deps import get_email_sender

    return app.dependency_overrides[get_email_sender]()


async def test_a_signup_started_in_the_app_hands_the_app_a_code_when_the_link_is_opened(
    new_client, app
) -> None:
    verifier, challenge = pair()
    body = {
        "email": "newcomer@example.com",
        "full_name": "New Comer",
        "password": "correct horse battery staple 91!",
        "app_challenge": challenge,
    }
    async with new_client() as the_app:
        assert (await the_app.post("/api/auth/signup", json=body)).status_code == 202
    token = sender(app).token_for("newcomer@example.com")
    async with new_client() as phone_browser:  # the link opens here, not in the app
        r = await phone_browser.post("/api/auth/verify", json={"token": token})
        assert r.status_code == 200 and set(r.json()) == {"app_code"}
        assert "set-cookie" not in r.headers or "session" not in r.headers["set-cookie"].lower()
        assert (
            await phone_browser.get("/api/me")
        ).status_code == 401  # the browser stays signed out
        code = r.json()["app_code"]
    async with new_client() as the_app:
        done = await the_app.post(
            "/api/auth/app-exchange", json={"code": code, "verifier": verifier}
        )
        assert done.status_code == 200
        me = await the_app.get("/api/me")
    assert me.status_code == 200
    assert me.json()["email"] == "newcomer@example.com"
    assert me.json()["full_name"] == "New Comer"  # the account really was created with its details


async def test_the_new_accounts_password_works_afterwards(new_client, app) -> None:
    verifier, challenge = pair()
    async with new_client() as the_app:
        await the_app.post(
            "/api/auth/signup",
            json={
                "email": "pw@example.com",
                "full_name": "Pass Word",
                "password": "correct horse battery staple 91!",
                "app_challenge": challenge,
            },
        )
    token = sender(app).token_for("pw@example.com")
    async with new_client() as b:
        await b.post("/api/auth/verify", json={"token": token})
    async with new_client() as c:
        r = await c.post(
            "/api/auth/login",
            json={"email": "pw@example.com", "password": "correct horse battery staple 91!"},
        )
    assert r.status_code == 200


async def test_a_sign_in_link_asked_for_by_the_app_works_the_same_way(new_client, app) -> None:
    verifier, challenge = pair()
    async with new_client() as the_app:
        r = await the_app.post(
            "/api/auth/request-link", json={"email": "link@example.com", "app_challenge": challenge}
        )
        assert r.status_code == 202
    token = sender(app).token_for("link@example.com")
    async with new_client() as b:
        out = await b.post("/api/auth/verify", json={"token": token})
        assert set(out.json()) == {"app_code"}
    async with new_client() as the_app:
        ok = await the_app.post(
            "/api/auth/app-exchange", json={"code": out.json()["app_code"], "verifier": verifier}
        )
    assert ok.status_code == 200


async def test_a_normal_signup_still_signs_the_browser_in(new_client, app) -> None:
    async with new_client() as c:
        await c.post(
            "/api/auth/signup",
            json={
                "email": "plain@example.com",
                "full_name": "Plain Person",
                "password": "correct horse battery staple 91!",
            },
        )
        token = sender(app).token_for("plain@example.com")
        r = await c.post("/api/auth/verify", json={"token": token})
        assert r.status_code == 200 and r.json()["email"] == "plain@example.com"
        assert (await c.get("/api/me")).status_code == 200


async def test_a_bad_challenge_is_refused_at_signup(new_client) -> None:
    async with new_client() as c:
        r = await c.post(
            "/api/auth/signup",
            json={
                "email": "x@example.com",
                "full_name": "Ex Ample",
                "password": "correct horse battery staple 91!",
                "app_challenge": "short",
            },
        )
    assert r.status_code == 422
