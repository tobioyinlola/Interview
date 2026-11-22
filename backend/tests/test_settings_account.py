"""Bio data on the account and changing the password from Settings."""

import pytest
from sqlalchemy import select

from app.models import AuthSession, User
from app.services.passwords import verify_password

PW = "correct horse battery"
NEW = "a brand new passphrase"


async def with_password(new_client, sign_in, email="pat@example.com", password=PW):
    c = new_client()
    await sign_in(c, email)
    r = await c.put("/api/account/password", json={"new_password": password})
    assert r.status_code == 200, r.text
    return c


# --------------------------------------------------------------------------------- bio data


async def test_bio_data_is_saved_and_returned(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "pat@example.com")
        r = await c.put(
            "/api/profile",
            json={
                "full_name": "Pat Jones",
                "phone": "  +234  801 234 5678 ",
                "location": "Lagos, Nigeria",
                "headline": "Senior product manager",
                "linkedin_url": "https://linkedin.com/in/patjones",
            },
        )
        me = r.json()
        assert r.status_code == 200 and me["phone"] == "+234 801 234 5678"
        assert me["location"] == "Lagos, Nigeria" and me["headline"] == "Senior product manager"
        assert me["linkedin_url"] == "https://linkedin.com/in/patjones"
        assert (await c.get("/api/me")).json()["phone"] == "+234 801 234 5678"


async def test_only_the_fields_sent_are_changed_and_empty_clears(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "pat@example.com")
        await c.put("/api/profile", json={"full_name": "Pat Jones", "location": "Lagos"})
        r = await c.put("/api/profile", json={"headline": "PM"})
        assert r.json()["full_name"] == "Pat Jones" and r.json()["location"] == "Lagos"
        cleared = await c.put("/api/profile", json={"location": ""})
        assert cleared.json()["location"] is None and cleared.json()["headline"] == "PM"


@pytest.mark.parametrize(
    "bad",
    [
        {"phone": "call me maybe"},
        {"phone": "123"},
        {"phone": "1" * 20},
        {"linkedin_url": "javascript:alert(1)"},
        {"linkedin_url": "not a url"},
        {"headline": "x" * 121},
        {"location": "a\x00b"},
    ],
)
async def test_nonsense_bio_data_is_refused_with_a_reason(new_client, sign_in, bad):
    async with new_client() as c:
        await sign_in(c, "pat@example.com")
        r = await c.put("/api/profile", json=bad)
        assert r.status_code == 422, bad


async def test_a_linkedin_address_without_the_scheme_is_tidied(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "pat@example.com")
        r = await c.put("/api/profile", json={"linkedin_url": "linkedin.com/in/pat"})
        assert r.json()["linkedin_url"] == "https://linkedin.com/in/pat"


async def test_the_name_is_still_checked(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "pat@example.com")
        r = await c.put("/api/profile", json={"full_name": "12345"})
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_name"


async def test_bio_data_is_private(new_client, sign_in):
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        await a.put("/api/profile", json={"phone": "+234 801 234 5678"})
        assert (await b.get("/api/me")).json()["phone"] is None


# ------------------------------------------------------------------------------- password


async def test_a_first_password_can_be_set_without_a_current_one(new_client, sign_in, engine):
    async with new_client() as c:
        await sign_in(c, "pat@example.com")
        assert (await c.get("/api/me")).json()["has_password"] is False
        r = await c.put("/api/account/password", json={"new_password": PW})
        assert r.status_code == 200 and r.json()["has_password"] is True
    login = await new_client().post(
        "/api/auth/login", json={"email": "pat@example.com", "password": PW}
    )
    assert login.status_code == 200


async def test_changing_it_needs_the_current_password(new_client, sign_in):
    c = await with_password(new_client, sign_in)
    for body in (
        {"new_password": NEW},
        {"current_password": "wrong password!", "new_password": NEW},
    ):
        r = await c.put("/api/account/password", json=body)
        assert r.status_code == 401 and r.json()["error"]["code"] == "wrong_password"
    ok = await c.put("/api/account/password", json={"current_password": PW, "new_password": NEW})
    assert ok.status_code == 200
    assert (
        await new_client().post(
            "/api/auth/login", json={"email": "pat@example.com", "password": NEW}
        )
    ).status_code == 200
    assert (
        await new_client().post(
            "/api/auth/login", json={"email": "pat@example.com", "password": PW}
        )
    ).status_code == 401


async def test_the_new_password_must_be_strong_and_different(new_client, sign_in):
    c = await with_password(new_client, sign_in)
    weak = await c.put(
        "/api/account/password", json={"current_password": PW, "new_password": "password123"}
    )
    assert weak.status_code == 422 and weak.json()["error"]["code"] == "weak_password"
    short = await c.put(
        "/api/account/password", json={"current_password": PW, "new_password": "short"}
    )
    assert short.status_code == 422
    same = await c.put("/api/account/password", json={"current_password": PW, "new_password": PW})
    assert same.json()["error"]["code"] == "same_password"
    assert (
        await new_client().post(
            "/api/auth/login", json={"email": "pat@example.com", "password": PW}
        )
    ).status_code == 200


async def test_every_other_device_is_signed_out_and_this_one_stays_in(new_client, sign_in, sender):
    c = await with_password(new_client, sign_in)
    other = new_client()
    await other.post("/api/auth/login", json={"email": "pat@example.com", "password": PW})
    assert (await other.get("/api/me")).status_code == 200
    await c.put("/api/account/password", json={"current_password": PW, "new_password": NEW})
    assert (await other.get("/api/me")).status_code == 401
    assert (await c.get("/api/me")).status_code == 200
    assert sender.kinds("pat@example.com").count("password_changed") == 2  # set, then changed


async def test_the_password_is_stored_hashed(new_client, sign_in, engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    await with_password(new_client, sign_in)
    async with async_sessionmaker(engine)() as db:
        user = (await db.execute(select(User))).scalar_one()
        assert PW not in user.password_hash and verify_password(PW, user.password_hash)
        assert (await db.execute(select(AuthSession))).scalars().first() is not None


async def test_guessing_the_current_password_is_limited(new_client, sign_in):
    c = await with_password(new_client, sign_in)
    for _ in range(10):
        await c.put(
            "/api/account/password",
            json={"current_password": "nope nope nope", "new_password": NEW},
        )
    r = await c.put("/api/account/password", json={"current_password": PW, "new_password": NEW})
    assert r.status_code == 429


async def test_changing_the_password_needs_a_signed_in_person(new_client):
    r = await new_client().put("/api/account/password", json={"new_password": NEW})
    assert r.status_code == 401
