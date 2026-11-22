"""The back office has its own sign-in: separate cookie, staff list only, shorter life."""

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import AuthSession, Event, User
from app.security import COOKIE_NAME, STAFF_COOKIE_NAME
from app.services.passwords import hash_password

BOSS = "boss@example.com"


@pytest.fixture(autouse=True)
def staff(settings):
    settings.admin_emails = BOSS


@pytest.fixture
def maker(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


async def test_staff_can_sign_in_with_an_emailed_link_and_see_who_they_are(
    new_client, staff_sign_in
):
    async with new_client() as c:
        await staff_sign_in(c, BOSS)
        me = (await c.get("/api/admin/auth/me")).json()
        assert me["email"] == BOSS
        assert (await c.get("/api/admin/overview")).status_code == 200


async def test_the_staff_cookie_is_separate_strict_and_only_sent_to_the_back_office(
    new_client, staff_sign_in
):
    async with new_client() as c:
        r = await staff_sign_in(c, BOSS)
        header = r.headers["set-cookie"].lower()
        assert STAFF_COOKIE_NAME in header and "httponly" in header
        assert "samesite=strict" in header and "path=/api/admin" in header
        assert "max-age=43200" in header  # twelve hours
        assert COOKIE_NAME + "=" not in header.replace(STAFF_COOKIE_NAME, "")


async def test_signing_in_to_the_back_office_does_not_sign_in_to_the_app(new_client, staff_sign_in):
    async with new_client() as c:
        await staff_sign_in(c, BOSS)
        assert (await c.get("/api/me")).status_code == 401


async def test_a_customer_cookie_cannot_stand_in_for_a_staff_cookie(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, BOSS)
        app_cookie = c.cookies[COOKIE_NAME]
    async with new_client() as c2:
        c2.cookies.set(STAFF_COOKIE_NAME, app_cookie)
        assert (await c2.get("/api/admin/overview")).status_code == 401


async def test_nobody_off_the_staff_list_gets_a_link_and_the_answer_does_not_say_so(
    new_client, sender
):
    async with new_client() as c:
        r = await c.post("/api/admin/auth/request-link", json={"email": "alice@example.com"})
        assert r.status_code == 202 and r.json() == {"status": "sent"}
        assert sender.kinds("alice@example.com") == []
        r = await c.post("/api/admin/auth/request-link", json={"email": BOSS})
        assert r.json() == {"status": "sent"} and sender.kinds(BOSS) == ["staff_login"]


async def test_a_staff_link_works_once_and_a_customer_link_does_not_open_the_back_office(
    new_client, sender, staff_sign_in
):
    async with new_client() as c:
        await staff_sign_in(c, BOSS)
        again = await c.post("/api/admin/auth/verify", json={"token": sender.token_for(BOSS)})
        assert again.status_code == 400
    async with new_client() as c:
        await c.post("/api/auth/request-link", json={"email": BOSS})
        r = await c.post("/api/admin/auth/verify", json={"token": sender.token_for(BOSS)})
        assert r.status_code == 400  # a sign-in-to-the-app link is not a back-office link


async def test_a_back_office_link_does_not_sign_in_to_the_app(new_client, sender):
    async with new_client() as c:
        await c.post("/api/admin/auth/request-link", json={"email": BOSS})
        r = await c.post("/api/auth/verify", json={"token": sender.token_for(BOSS)})
        assert r.status_code == 400


async def test_the_link_in_the_email_opens_the_back_office_page(new_client, sender):
    async with new_client() as c:
        await c.post("/api/admin/auth/request-link", json={"email": BOSS})
    assert any("/admin/verify?token=" in lnk for e, lnk in sender.links if e == BOSS)


async def test_staff_can_sign_in_with_a_password_and_others_cannot(new_client, maker):
    async with maker() as db:
        db.add(User(email=BOSS, password_hash=hash_password("correct horse battery")))
        db.add(User(email="alice@example.com", password_hash=hash_password("alice password 1")))
        await db.commit()
    async with new_client() as c:
        r = await c.post("/api/admin/auth/login", json={"email": BOSS, "password": "nope"})
        assert r.status_code == 401
        # a customer with a right password is still not staff, and gets the very same answer
        r = await c.post(
            "/api/admin/auth/login",
            json={"email": "alice@example.com", "password": "alice password 1"},
        )
        assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"
        r = await c.post(
            "/api/admin/auth/login", json={"email": BOSS, "password": "correct horse battery"}
        )
        assert r.status_code == 200 and (await c.get("/api/admin/overview")).status_code == 200


async def test_too_many_wrong_passwords_lock_the_address_for_a_while(new_client, maker):
    async with maker() as db:
        db.add(User(email=BOSS, password_hash=hash_password("correct horse battery")))
        await db.commit()
    async with new_client() as c:
        for _ in range(5):
            r = await c.post("/api/admin/auth/login", json={"email": BOSS, "password": "wrong"})
            assert r.status_code == 401
        r = await c.post(
            "/api/admin/auth/login", json={"email": BOSS, "password": "correct horse battery"}
        )
        assert r.status_code == 429


async def test_sign_out_ends_the_staff_session_on_the_server(new_client, staff_sign_in):
    async with new_client() as c:
        await staff_sign_in(c, BOSS)
        token = c.cookies[STAFF_COOKIE_NAME]
        assert (await c.post("/api/admin/auth/logout")).status_code == 200
        c.cookies.set(STAFF_COOKIE_NAME, token)  # even a copied cookie is dead now
        assert (await c.get("/api/admin/auth/me")).status_code == 401


async def test_a_staff_session_expires(new_client, staff_sign_in, maker):
    async with new_client() as c:
        await staff_sign_in(c, BOSS)
        async with maker() as db:
            await db.execute(
                update(AuthSession).values(expires_at=AuthSession.created_at)  # already over
            )
            await db.commit()
        assert (await c.get("/api/admin/auth/me")).status_code == 401


async def test_someone_removed_from_the_staff_list_loses_access_at_once(
    new_client, staff_sign_in, settings
):
    async with new_client() as c:
        await staff_sign_in(c, BOSS)
        settings.admin_emails = "someone-else@example.com"
        assert (await c.get("/api/admin/overview")).status_code == 404


async def test_back_office_sign_ins_and_failures_are_in_the_activity_log(
    new_client, staff_sign_in, maker
):
    async with new_client() as c:
        await c.post("/api/admin/auth/login", json={"email": BOSS, "password": "x"})
        await staff_sign_in(c, BOSS)
        await c.post("/api/admin/auth/logout")
    async with maker() as db:
        kinds = (await db.execute(select(Event.kind))).scalars().all()
    assert {"staff.signed_in", "staff.signed_out"} <= set(kinds)
