"""Consent that the partner knows the assistant is on: agreed once, not at every session."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import PracticeSession, User

EMAIL = "pat@example.com"
PASSWORD = "correct horse battery staple"


async def start(c, **body):  # type: ignore[no-untyped-def]
    return await c.post("/api/sessions", json=body)


async def signed_up(new_client, sender, *, consent: bool):  # type: ignore[no-untyped-def]
    c = new_client()
    client = await c.__aenter__()
    r = await client.post(
        "/api/auth/signup",
        json={
            "email": EMAIL,
            "password": PASSWORD,
            "full_name": "Pat Rivera",
            "partner_consent": consent,
        },
    )
    assert r.status_code == 202
    v = await client.post("/api/auth/verify", json={"token": sender.token_for(EMAIL)})
    assert v.status_code == 200
    return c, client


async def test_signing_up_with_the_box_ticked_means_no_asking_at_the_first_session(
    new_client, sender
) -> None:
    c, client = await signed_up(new_client, sender, consent=True)
    try:
        assert (await client.get("/api/me")).json()["practice_consent"] is True
        r = await start(client)  # no consent field at all
        assert r.status_code == 201 and r.json()["consent_confirmed_at"]
    finally:
        await c.__aexit__(None, None, None)


async def test_signing_up_without_the_box_means_it_is_asked_once(new_client, sender) -> None:
    c, client = await signed_up(new_client, sender, consent=False)
    try:
        assert (await client.get("/api/me")).json()["practice_consent"] is False
        refused = await start(client)
        assert refused.status_code == 400
        assert refused.json()["error"]["code"] == "consent_required"
        assert (await start(client, consent=True)).status_code == 201  # agreeing remembers it
        assert (await client.get("/api/me")).json()["practice_consent"] is True
        assert (await start(client)).status_code == 201  # not asked again
    finally:
        await c.__aexit__(None, None, None)


async def test_a_session_is_still_refused_when_consent_is_false_and_none_is_on_record(
    new_client, sender
) -> None:
    c, client = await signed_up(new_client, sender, consent=False)
    try:
        assert (await start(client, consent=False)).status_code == 400
        assert (await client.get("/api/me")).json()["practice_consent"] is False
    finally:
        await c.__aexit__(None, None, None)


async def test_the_person_can_ask_to_be_asked_every_time_and_change_back(
    new_client, sender
) -> None:
    c, client = await signed_up(new_client, sender, consent=True)
    try:
        r = await client.put("/api/practice-consent", json={"ask_every_time": True})
        assert r.status_code == 200 and r.json()["practice_consent"] is False
        assert r.json()["consent_each_time"] is True
        assert (await start(client)).status_code == 400  # asked again
        # confirming is for that one session only: it is not remembered, as they asked
        assert (await start(client, consent=True)).status_code == 201
        assert (await client.get("/api/me")).json()["practice_consent"] is False
        assert (await start(client)).status_code == 400
        r = await client.put("/api/practice-consent", json={"ask_every_time": False})
        assert r.json()["practice_consent"] is True
        assert (await start(client)).status_code == 201
    finally:
        await c.__aexit__(None, None, None)


async def test_the_box_cannot_grant_consent_to_an_account_that_already_exists(
    new_client, sender, engine
) -> None:
    """Like the password and the name: a sign-up started by someone else for an existing address
    changes nothing about that person's account."""
    c1, first = await signed_up(new_client, sender, consent=False)
    await c1.__aexit__(None, None, None)
    async with new_client() as other:
        await other.post(
            "/api/auth/signup",
            json={
                "email": EMAIL,
                "password": PASSWORD,
                "full_name": "Someone Else",
                "partner_consent": True,
            },
        )
    async with async_sessionmaker(engine)() as s:
        (user,) = list((await s.execute(select(User))).scalars())
        assert user.practice_consent_at is None


async def test_each_session_records_when_it_started_under_the_agreement(
    new_client, sender, engine
) -> None:
    c, client = await signed_up(new_client, sender, consent=True)
    try:
        await start(client)
        async with async_sessionmaker(engine)() as s:
            (row,) = list((await s.execute(select(PracticeSession))).scalars())
            assert row.consent_confirmed_at is not None
    finally:
        await c.__aexit__(None, None, None)
