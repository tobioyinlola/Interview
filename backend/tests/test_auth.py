import httpx
from sqlalchemy import select, update

from app.config import Settings, get_settings
from app.deps import get_email_sender  # noqa: F401
from app.models import AuthSession, LoginToken


async def test_request_link_is_identical_for_new_and_known_emails(new_client, sign_in):
    async with new_client() as c, new_client() as c2:
        await sign_in(c, "known@example.com")
        a = await c2.post("/api/auth/request-link", json={"email": "known@example.com"})
        b = await c2.post("/api/auth/request-link", json={"email": "stranger@example.com"})
    assert a.status_code == b.status_code == 202
    assert a.json() == b.json() == {"status": "sent"}


async def test_sign_in_sets_http_only_cookie_and_me_works(new_client, sign_in):
    async with new_client() as c:
        v = await sign_in(c, "A@Example.com")
        cookie = v.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=lax" in cookie
        me = await c.get("/api/me")
    assert me.status_code == 200
    assert me.json()["email"] == "a@example.com"  # normalised


async def test_cookie_is_secure_outside_local(new_client, app, sign_in, settings):
    prod = Settings(environment="production", cookie_secret="test-secret")  # type: ignore[arg-type]
    app.dependency_overrides[get_settings] = lambda: prod
    async with new_client() as c:
        # request-link works with any sender override; verify sets the cookie flags
        await c.post("/api/auth/request-link", json={"email": "p@example.com"})
        token = app.dependency_overrides[get_email_sender]().token_for("p@example.com")
        v = await c.post("/api/auth/verify", json={"token": token})
    assert "secure" in v.headers["set-cookie"].lower()


async def test_me_requires_sign_in(new_client):
    async with new_client() as c:
        r = await c.get("/api/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "not_authenticated"


async def test_login_token_is_single_use(new_client, sender):
    async with new_client() as c:
        await c.post("/api/auth/request-link", json={"email": "s@example.com"})
        token = sender.token_for("s@example.com")
        first = await c.post("/api/auth/verify", json={"token": token})
        second = await c.post("/api/auth/verify", json={"token": token})
    assert first.status_code == 200
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "invalid_link"


async def test_expired_token_is_rejected(new_client, sender, db):
    async with new_client() as c:
        await c.post("/api/auth/request-link", json={"email": "e@example.com"})
        await db.execute(update(LoginToken).values(expires_at=LoginToken.created_at))
        await db.commit()
        r = await c.post("/api/auth/verify", json={"token": sender.token_for("e@example.com")})
    assert r.status_code == 400


async def test_garbage_token_is_rejected(new_client):
    async with new_client() as c:
        r = await c.post("/api/auth/verify", json={"token": "x" * 40})
    assert r.status_code == 400


async def test_tokens_are_stored_hashed_only(new_client, sender, db):
    async with new_client() as c:
        await c.post("/api/auth/request-link", json={"email": "h@example.com"})
        token = sender.token_for("h@example.com")
        v = await c.post("/api/auth/verify", json={"token": token})
        cookie = c.cookies.get("session")
    stored = [t.token_hash for t in (await db.execute(select(LoginToken))).scalars()]
    stored += [s.token_hash for s in (await db.execute(select(AuthSession))).scalars()]
    assert v.status_code == 200 and cookie
    assert token not in stored and cookie not in stored


async def test_logout_revokes_the_session(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "l@example.com")
        old_cookie = c.cookies.get("session")
        assert (await c.post("/api/auth/logout")).status_code == 200
        replay = httpx.AsyncClient(
            transport=c._transport, base_url="http://test", cookies={"session": old_cookie}
        )
        async with replay:
            r = await replay.get("/api/me")
    assert r.status_code == 401


async def test_login_requests_are_rate_limited(new_client):
    async with new_client() as c:
        codes = [
            (await c.post("/api/auth/request-link", json={"email": "r@example.com"})).status_code
            for _ in range(7)
        ]
    assert codes[:5] == [202] * 5
    assert codes[5:] == [429, 429]


async def test_mutations_need_the_csrf_header(app):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:  # no CSRF header
        r = await c.post("/api/auth/request-link", json={"email": "c@example.com"})
        g = await c.get("/api/me")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "csrf_failed"
    assert g.status_code == 401  # GETs are not blocked by the CSRF check


# ------------------------------------------------------------------ inactivity


async def _age_session(db, minutes: int) -> None:
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import update

    from app.models import AuthSession

    await db.execute(
        update(AuthSession).values(last_seen_at=datetime.now(UTC) - timedelta(minutes=minutes))
    )
    await db.commit()


async def test_a_session_unused_for_twenty_minutes_is_signed_out(new_client, sign_in, db):
    async with new_client() as c:
        await sign_in(c, "ada@example.com")
        assert (await c.get("/api/me")).status_code == 200
        await _age_session(db, 19)  # still within the limit
        assert (await c.get("/api/me")).status_code == 200
        await _age_session(db, 21)
        r = await c.get("/api/me")
        assert r.status_code == 401 and r.json()["error"]["code"] == "not_authenticated"
        # and it stays ended: the cookie is no longer any good
        assert (await c.get("/api/me")).status_code == 401


async def test_using_the_app_keeps_the_session_alive(new_client, sign_in, db):
    async with new_client() as c:
        await sign_in(c, "ada@example.com")
        await _age_session(db, 15)
        assert (await c.get("/api/me")).status_code == 200  # a request counts as being here
        await _age_session(db, 15)
        assert (await c.get("/api/me")).status_code == 200
