"""Inviting yourself from a second email does not count, even in another browser or window."""

import pytest
from fastapi import Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.datastructures import Headers

from app.config import Settings
from app.models import Referral, User, UserDevice
from app.services.devices import (
    DEVICE_COOKIE,
    DeviceInfo,
    observe_device,
    same_device,
)
from tests.conftest import TEST_DB
from tests.test_billing import code_of

FP = "a" * 64
OTHER_FP = "b" * 64


@pytest.fixture
def settings() -> Settings:
    return Settings(  # type: ignore[call-overload,no-any-return]
        environment="local",
        database_url=TEST_DB,
        cookie_secret="test-secret",
        enforce_session_credits=True,
        open_link_signup=True,  # accounts here are made by an emailed link; see test_registration
        trust_proxy_headers=True,  # so the caller's address can be told apart in tests
    )


def req(cookie: str | None = None, fp: str | None = None, ip: str | None = None) -> Request:
    h = {}
    if cookie:
        h["cookie"] = f"{DEVICE_COOKIE}={cookie}"
    if fp:
        h["x-device-fp"] = fp
    if ip:
        h["x-forwarded-for"] = ip
    scope = {"type": "http", "headers": Headers(h).raw, "method": "GET", "path": "/"}
    return Request(scope)


S = Settings(environment="local", cookie_secret="test-secret", trust_proxy_headers=True)  # type: ignore[call-overload]


# ------------------------------------------------------------------ the pieces


def test_a_cookie_match_alone_is_enough() -> None:
    assert same_device(DeviceInfo("c1"), DeviceInfo("c1", "p2", "i2"))
    assert not same_device(DeviceInfo("c1"), DeviceInfo("c2"))


def test_a_fingerprint_match_needs_the_same_network_address_too() -> None:
    a = DeviceInfo(None, "p1", "i1")
    assert same_device(a, DeviceInfo("other", "p1", "i1"))
    assert not same_device(a, DeviceInfo(None, "p1", "i2"))  # same laptop model elsewhere
    assert not same_device(a, DeviceInfo(None, "p1", None))  # no address known: not enough
    assert not same_device(a, DeviceInfo(None, "p2", "i1"))  # same house, different machine


def test_empty_sightings_never_match() -> None:
    assert not same_device(DeviceInfo(), DeviceInfo())


def test_a_browser_without_a_device_id_is_given_one_and_keeps_it() -> None:
    r = Response()
    first = observe_device(req(), r, S)
    cookie = r.headers["set-cookie"]
    assert (
        DEVICE_COOKIE in cookie
        and "httponly" in cookie.lower()
        and "samesite=lax" in cookie.lower()
    )
    value = cookie.split(";")[0].split("=", 1)[1]
    again = observe_device(req(cookie=value), Response(), S)
    assert again.cookie_hash == first.cookie_hash or first.cookie_hash != again.cookie_hash
    r2 = Response()
    observe_device(req(cookie=value), r2, S)
    assert "set-cookie" not in r2.headers  # already has one: not replaced


def test_a_made_up_device_id_is_replaced() -> None:
    r = Response()
    observe_device(req(cookie="short"), r, S)
    assert DEVICE_COOKIE in r.headers["set-cookie"]


def test_only_a_well_formed_fingerprint_is_used() -> None:
    assert observe_device(req(fp="not-a-hash"), Response(), S).print_hash is None
    assert observe_device(req(fp=FP), Response(), S).print_hash is not None


def test_the_address_is_used_only_when_forwarded_addresses_are_trusted() -> None:
    trusted = observe_device(req(ip="8.8.4.4, 10.0.0.1"), Response(), S)
    assert trusted.ip_hash is not None
    untrusted = Settings(environment="local", cookie_secret="test-secret")  # type: ignore[call-overload]
    assert observe_device(req(ip="8.8.4.4"), Response(), untrusted).ip_hash is None


def test_what_is_kept_is_a_hash_not_the_value() -> None:
    d = observe_device(req(cookie="x" * 30, fp=FP, ip="8.8.4.4"), Response(), S)
    for h in (d.cookie_hash, d.print_hash, d.ip_hash):
        assert h and len(h) == 64
        assert "8.8.4.4" not in h and "x" * 30 not in h and FP not in h


# ------------------------------------------------------------------ the whole flow


async def rows(engine, model):  # type: ignore[no-untyped-def]
    async with async_sessionmaker(engine)() as s:
        return list((await s.execute(select(model))).scalars())


async def ask_and_open(client, sender, email, ref=None, headers=None, opener=None):  # type: ignore[no-untyped-def]
    """Ask for a sign-in link as `email`, and open it in `opener` (default: the same client)."""
    body = {"email": email, **({"ref": ref} if ref else {})}
    r = await client.post("/api/auth/request-link", json=body, headers=headers or {})
    assert r.status_code == 202
    v = await (opener or client).post(
        "/api/auth/verify", json={"token": sender.token_for(email)}, headers=headers or {}
    )
    assert v.status_code == 200, v.text
    return v


async def invited(engine):  # type: ignore[no-untyped-def]
    return {r.status for r in await rows(engine, Referral)}, await rows(engine, Referral)


async def test_a_second_email_on_the_same_browser_is_held(new_client, sender, engine) -> None:
    async with new_client() as me:
        await ask_and_open(me, sender, "me@example.com")
        code = await code_of(me)
        await me.post("/api/auth/logout")
        # the same browser, the same device cookie, a different email address
        await ask_and_open(me, sender, "my-other-address@example.org", ref=code)
    statuses, refs = await invited(engine)
    assert statuses == {"held"} and refs[0].held_reason == "same_device"


async def test_held_sign_ups_do_not_count_and_the_inviter_is_told(new_client, sender) -> None:
    async with new_client() as me:
        await ask_and_open(me, sender, "me@example.com")
        code = await code_of(me)
        for i in range(3):
            await me.post("/api/auth/logout")
            await ask_and_open(me, sender, f"alt{i}@example.org", ref=code)
        await me.post("/api/auth/logout")
        await ask_and_open(me, sender, "me@example.com")
        b = (await me.get("/api/billing")).json()
        assert b["referrals_qualified"] == 0 and b["referrals_held"] == 3
        assert b["rewards_earned"] == 0 and b["rewards_redeemable"] == 0
        assert (await me.post("/api/billing/redeem")).status_code == 409


async def test_a_real_friend_on_their_own_device_still_counts(new_client, sender, engine) -> None:
    async with new_client() as me, new_client() as friend:
        await ask_and_open(me, sender, "me@example.com")
        await ask_and_open(friend, sender, "friend@example.com", ref=await code_of(me))
        assert (await me.get("/api/billing")).json()["referrals_qualified"] == 1
    assert {r.status for r in await rows(engine, Referral)} == {"counted"}


async def test_a_private_window_on_the_same_machine_is_caught_by_fingerprint_and_address(
    new_client, sender, engine
) -> None:
    same = {"x-device-fp": FP, "x-forwarded-for": "8.8.4.4"}
    async with new_client() as me, new_client() as private_window:
        await ask_and_open(me, sender, "me@example.com", headers=same)
        await ask_and_open(
            private_window, sender, "second@example.org", ref=await code_of(me), headers=same
        )
    assert {r.status for r in await rows(engine, Referral)} == {"held"}


@pytest.mark.parametrize(
    ("friend_headers", "why"),
    [
        (
            {"x-device-fp": FP, "x-forwarded-for": "1.1.1.1"},
            "same laptop model, another place",
        ),
        (
            {"x-device-fp": OTHER_FP, "x-forwarded-for": "8.8.4.4"},
            "same house, another machine",
        ),
        ({"x-forwarded-for": "8.8.4.4"}, "no fingerprint"),
        ({"x-device-fp": FP}, "no address"),
    ],
)
async def test_a_look_alike_that_is_not_the_same_machine_still_counts(
    new_client, sender, engine, friend_headers, why
) -> None:
    mine = {"x-device-fp": FP, "x-forwarded-for": "8.8.4.4"}
    async with new_client() as me, new_client() as friend:
        await ask_and_open(me, sender, "me@example.com", headers=mine)
        await ask_and_open(
            friend, sender, "friend@example.com", ref=await code_of(me), headers=friend_headers
        )
    assert {r.status for r in await rows(engine, Referral)} == {"counted"}, why


async def test_asking_for_the_link_on_one_device_and_opening_it_on_the_inviters_is_held(
    new_client, sender, engine
) -> None:
    async with new_client() as me, new_client() as other_device:
        await ask_and_open(me, sender, "me@example.com")
        code = await code_of(me)
        # the new address asks for its link on a fresh device, then opens it on mine (a phone)
        await ask_and_open(other_device, sender, "second@example.org", ref=code, opener=me)
    assert {r.status for r in await rows(engine, Referral)} == {"held"}


async def test_asking_on_the_inviters_device_and_opening_the_link_elsewhere_is_held(
    new_client, sender, engine
) -> None:
    async with new_client() as me, new_client() as phone:
        await ask_and_open(me, sender, "me@example.com")
        code = await code_of(me)
        # the new address asks for its link on my device, then opens it on a fresh phone
        await ask_and_open(me, sender, "second@example.org", ref=code, opener=phone)
    assert {r.status for r in await rows(engine, Referral)} == {"held"}


async def test_one_person_cannot_make_several_friends_from_one_device(
    new_client, sender, engine
) -> None:
    async with new_client() as me, new_client() as laptop:
        await ask_and_open(me, sender, "me@example.com")
        code = await code_of(me)
        for i in range(3):
            await laptop.post("/api/auth/logout")
            await ask_and_open(laptop, sender, f"fake{i}@example.org", ref=code)
        refs = sorted(await rows(engine, Referral), key=lambda r: r.created_at)
    # the first is not the inviter's device so it counts; the rest are the same device as it
    assert [r.status for r in refs] == ["counted", "held", "held"]


async def test_signing_in_again_on_the_same_device_is_recorded_once(
    new_client, sender, engine
) -> None:
    async with new_client() as me:
        await ask_and_open(me, sender, "me@example.com")
        for _ in range(3):
            await me.post("/api/auth/logout")
            await ask_and_open(me, sender, "me@example.com")
    assert len(await rows(engine, UserDevice)) == 1


async def test_a_returning_account_with_no_device_on_record_gets_one_when_it_signs_in(
    new_client, sender, engine
) -> None:
    """Accounts that existed before devices were tracked are covered from their next sign-in."""
    async with new_client() as me:
        await ask_and_open(me, sender, "me@example.com")
        code = await code_of(me)
        async with async_sessionmaker(engine)() as s:  # as if the account predates the check
            await s.execute(UserDevice.__table__.delete())
            await s.commit()
        await me.post("/api/auth/logout")
        await ask_and_open(me, sender, "me@example.com")  # an ordinary sign-in
        assert len(await rows(engine, UserDevice)) == 1
        await me.post("/api/auth/logout")
        await ask_and_open(me, sender, "second@example.org", ref=code)
    assert {r.status for r in await rows(engine, Referral)} == {"held"}


async def test_the_database_holds_no_raw_device_values(new_client, sender, engine) -> None:
    async with new_client() as me:
        await ask_and_open(
            me,
            sender,
            "me@example.com",
            headers={"x-device-fp": FP, "x-forwarded-for": "8.8.4.4"},
        )
        raw_cookie = me.cookies.get(DEVICE_COOKIE)
    assert raw_cookie
    (device,) = await rows(engine, UserDevice)
    stored = " ".join(str(v) for v in (device.cookie_hash, device.print_hash, device.ip_hash))
    assert raw_cookie not in stored and FP not in stored and "8.8.4.4" not in stored


async def test_devices_go_when_the_account_is_deleted(new_client, sender, engine) -> None:
    async with new_client() as me:
        await ask_and_open(me, sender, "me@example.com")
        assert (await me.delete("/api/account")).status_code in (200, 202)
    async with async_sessionmaker(engine)() as s:
        assert await s.scalar(select(func.count()).select_from(UserDevice)) == 0
        assert await s.scalar(select(func.count()).select_from(User)) == 0
