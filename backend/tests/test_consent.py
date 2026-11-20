"""The partner-awareness agreement is given once, at sign-up. The app never asks again."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import PracticeSession, User

EMAIL = "pat@example.com"
PASSWORD = "correct horse battery staple"


async def users(engine):  # type: ignore[no-untyped-def]
    async with async_sessionmaker(engine)() as s:
        return list((await s.execute(select(User))).scalars())


async def test_signing_up_records_the_agreement_and_the_first_session_needs_nothing_more(
    new_client, sender, engine
) -> None:
    async with new_client() as c:
        before = datetime.now(UTC) - timedelta(seconds=5)
        r = await c.post(
            "/api/auth/signup",
            json={"email": EMAIL, "password": PASSWORD, "full_name": "Pat Rivera"},
        )
        assert r.status_code == 202
        assert (await users(engine)) == []  # nothing until the emailed link is opened
        v = await c.post("/api/auth/verify", json={"token": sender.token_for(EMAIL)})
        assert v.status_code == 200
        (user,) = await users(engine)
        assert user.practice_consent_at is not None and user.practice_consent_at > before
        started = await c.post("/api/sessions", json={})  # no consent field, nothing to tick
        assert started.status_code == 201


async def test_the_session_records_when_the_person_agreed(new_client, sign_in, engine) -> None:
    async with new_client() as c:
        await sign_in(c, "a@example.com")
        (user,) = await users(engine)
        r = await c.post("/api/sessions", json={})
        assert r.status_code == 201
    async with async_sessionmaker(engine)() as s:
        row = (await s.execute(select(PracticeSession))).scalar_one()
        assert row.consent_confirmed_at == user.practice_consent_at


async def test_an_account_made_with_a_sign_in_link_has_it_too(new_client, sign_in, engine) -> None:
    async with new_client() as c:
        await sign_in(c, "link@example.com")
    (user,) = await users(engine)
    assert user.practice_consent_at is not None


async def test_the_account_details_carry_no_consent_switch(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, "me@example.com")
        me = (await c.get("/api/me")).json()
        assert "practice_consent" not in me and "consent_each_time" not in me
        assert (await c.put("/api/practice-consent", json={})).status_code in (404, 405)
