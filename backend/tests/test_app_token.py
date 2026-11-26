"""The installed apps carry their own interface, so they are not the website's origin and cannot use
its cookie. They sign in for a bearer token instead; the website is untouched."""

import httpx

from app.security import CSRF_HEADER
from tests.test_app_signin import pair
from tests.test_passwords import EMAIL, GOOD, confirm, login, signup

APP = {"x-client": "app"}
ORIGIN = "https://localhost"


async def an_account(new_client, sender):  # type: ignore[no-untyped-def]
    async with new_client() as c:
        await signup(c)
        await confirm(c, sender)


def bare(app) -> httpx.AsyncClient:  # type: ignore[no-untyped-def]
    """An app's HTTP client: no cookie jar worth anything, no CSRF header."""
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_the_website_still_gets_a_cookie_and_no_token(new_client, sender) -> None:
    await an_account(new_client, sender)
    async with new_client() as c:
        r = await login(c)
        assert r.status_code == 200
        assert "httponly" in r.headers["set-cookie"].lower()
        assert "x-session-token" not in r.headers


async def test_an_app_signs_in_for_a_token_and_uses_it_as_a_bearer(app, new_client, sender) -> None:
    await an_account(new_client, sender)
    async with bare(app) as c:
        r = await c.post(
            "/api/auth/login",
            json={"email": EMAIL, "password": GOOD},
            headers={**APP, CSRF_HEADER: "meet-practice"},
        )
        assert r.status_code == 200
        token = r.headers["x-session-token"]
        assert "session=" not in r.headers.get("set-cookie", "")  # no session cookie to hold
        assert (await c.get("/api/me")).status_code == 401  # no token, no access
        me = await c.get("/api/me", headers={"authorization": f"Bearer {token}"})
        assert me.status_code == 200 and me.json()["email"] == EMAIL
        junk = await c.get("/api/me", headers={"authorization": "Bearer nonsense"})
        assert junk.status_code == 401


async def test_a_bearer_request_needs_no_csrf_header_but_a_cookie_one_still_does(
    app, new_client, sender
) -> None:
    await an_account(new_client, sender)
    async with bare(app) as c:
        token = (
            await c.post(
                "/api/auth/login",
                json={"email": EMAIL, "password": GOOD},
                headers={**APP, CSRF_HEADER: "meet-practice"},
            )
        ).headers["x-session-token"]
        ok = await c.post("/api/auth/logout", headers={"authorization": f"Bearer {token}"})
        assert ok.status_code == 200
    # a state-changing call with neither the header nor a bearer is still refused
    async with bare(app) as c:
        r = await c.post("/api/auth/logout")
        assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"


async def test_signing_out_ends_the_token(app, new_client, sender) -> None:
    await an_account(new_client, sender)
    async with bare(app) as c:
        h = {**APP, CSRF_HEADER: "meet-practice"}
        token = (
            await c.post("/api/auth/login", json={"email": EMAIL, "password": GOOD}, headers=h)
        ).headers["x-session-token"]
        bearer = {"authorization": f"Bearer {token}"}
        assert (await c.get("/api/me", headers=bearer)).status_code == 200
        await c.post("/api/auth/logout", headers=bearer)
        assert (await c.get("/api/me", headers=bearer)).status_code == 401


async def test_changing_the_password_gives_the_app_a_fresh_token(app, new_client, sender) -> None:
    await an_account(new_client, sender)
    async with bare(app) as c:
        h = {**APP, CSRF_HEADER: "meet-practice"}
        old = (
            await c.post("/api/auth/login", json={"email": EMAIL, "password": GOOD}, headers=h)
        ).headers["x-session-token"]
        r = await c.put(
            "/api/account/password",
            json={"current_password": GOOD, "new_password": "a brand new passphrase!"},
            headers={**APP, "authorization": f"Bearer {old}"},
        )
        assert r.status_code == 200
        fresh = r.headers["x-session-token"]
        assert fresh != old
        assert (
            await c.get("/api/me", headers={"authorization": f"Bearer {old}"})
        ).status_code == 401
        assert (
            await c.get("/api/me", headers={"authorization": f"Bearer {fresh}"})
        ).status_code == 200


async def test_the_code_from_the_browser_becomes_a_token_for_the_app(
    app, new_client, sender
) -> None:
    verifier, challenge = pair()
    async with new_client() as a_browser:
        await a_browser.post(
            "/api/auth/signup",
            json={
                "email": "newcomer@example.com",
                "full_name": "New Comer",
                "password": GOOD,
                "app_challenge": challenge,
            },
        )
    token = sender.token_for("newcomer@example.com")
    async with new_client() as phone_browser:
        code = (await phone_browser.post("/api/auth/verify", json={"token": token})).json()[
            "app_code"
        ]
    async with bare(app) as c:
        r = await c.post(
            "/api/auth/app-exchange",
            json={"code": code, "verifier": verifier},
            headers={**APP, CSRF_HEADER: "meet-practice"},
        )
        assert r.status_code == 200 and "set-cookie" not in r.headers
        me = await c.get(
            "/api/me", headers={"authorization": f"Bearer {r.headers['x-session-token']}"}
        )
        assert me.json()["email"] == "newcomer@example.com"


async def test_only_the_websites_and_the_apps_own_addresses_may_call_the_api(app) -> None:
    async with bare(app) as c:

        async def preflight(origin: str) -> httpx.Response:
            return await c.options(
                "/api/me",
                headers={
                    "origin": origin,
                    "access-control-request-method": "GET",
                    "access-control-request-headers": "authorization,x-client",
                },
            )

        ok = await preflight(ORIGIN)
        assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == ORIGIN
        assert (await preflight("capacitor://localhost")).status_code == 200
        assert (await preflight("app://interviewmeet")).status_code == 200
        # the Tauri desktop app's own addresses
        for tauri in ("https://tauri.localhost", "tauri://localhost"):
            ok_t = await preflight(tauri)
            assert ok_t.status_code == 200 and ok_t.headers["access-control-allow-origin"] == tauri
        bad = await preflight("https://evil.example")
        assert "access-control-allow-origin" not in bad.headers
        shown = await c.get("/api/me", headers={"origin": ORIGIN})
        assert "x-session-token" in shown.headers["access-control-expose-headers"]
