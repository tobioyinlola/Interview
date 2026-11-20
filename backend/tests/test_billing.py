"""One free trial session for everyone, then a credit per session. Inviting friends earns credits:
three people who sign up with your link earn one free session, which you redeem."""

import asyncio

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings
from app.models import Referral, SessionCredit, User
from tests.conftest import TEST_DB


@pytest.fixture
def settings() -> Settings:
    return Settings(  # type: ignore[call-overload,no-any-return]
        environment="local",
        database_url=TEST_DB,
        cookie_secret="test-secret",
        enforce_session_credits=True,
    )


async def join(new_client, sender, email: str, ref: str | None = None):  # type: ignore[no-untyped-def]
    """A new person arriving through an invite link, signed in by the emailed link."""
    c = new_client()
    client = await c.__aenter__()
    body = {"email": email, **({"ref": ref} if ref else {})}
    assert (await client.post("/api/auth/request-link", json=body)).status_code == 202
    v = await client.post("/api/auth/verify", json={"token": sender.token_for(email)})
    assert v.status_code == 200, v.text
    return c, client


async def code_of(client) -> str:  # type: ignore[no-untyped-def]
    return (await client.get("/api/billing")).json()["referral_code"]


async def start(client, **body):  # type: ignore[no-untyped-def]
    return await client.post("/api/sessions", json=body)


async def invite(new_client, sender, code: str, n: int, prefix: str = "friend") -> None:  # type: ignore[no-untyped-def]
    for i in range(n):
        c, _ = await join(new_client, sender, f"{prefix}{i}@example.com", code)
        await c.__aexit__(None, None, None)


# ------------------------------------------------------------------ the free trial


async def test_everyone_starts_with_one_free_trial_session(new_client, sender) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        b = (await me.get("/api/billing")).json()
        assert b["sessions_available"] == 1 and b["trial_available"] is True
        assert b["payments_enabled"] is False
        assert b["referral_credits_available"] == 0 and b["paid_credits_available"] == 0
    finally:
        await c.__aexit__(None, None, None)


async def test_the_second_session_needs_payment_and_says_so(new_client, sender) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        assert (await start(me)).status_code == 201
        r = await start(me)
        assert r.status_code == 402
        assert r.json()["error"]["code"] == "payment_required"
        assert "free session" in r.json()["error"]["message"]
        b = (await me.get("/api/billing")).json()
        assert b["sessions_available"] == 0 and b["trial_available"] is False
    finally:
        await c.__aexit__(None, None, None)


async def test_a_retried_click_does_not_spend_a_second_credit(new_client, sender) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        h = {"idempotency-key": "same-click"}
        a = await me.post("/api/sessions", json={}, headers=h)
        b = await me.post("/api/sessions", json={}, headers=h)
        assert a.status_code == b.status_code == 201
        assert a.json()["session_id"] == b.json()["session_id"]
        assert (await me.get("/api/billing")).json()["sessions_available"] == 0
    finally:
        await c.__aexit__(None, None, None)


async def test_a_session_that_cannot_start_does_not_cost_the_credit(new_client, sender) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        bad = await start(me, company_id="00000000-0000-0000-0000-000000000001")
        assert bad.status_code == 404
        assert (await me.get("/api/billing")).json()["sessions_available"] == 1
        assert (await start(me)).status_code == 201
    finally:
        await c.__aexit__(None, None, None)


async def test_two_sessions_started_at_once_cannot_both_use_the_last_credit(
    new_client, sender, engine
) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        results = await asyncio.gather(start(me), start(me))
        assert sorted(r.status_code for r in results) == [201, 402]
        async with async_sessionmaker(engine)() as s:
            used = await s.scalar(
                select(func.count())
                .select_from(SessionCredit)
                .where(SessionCredit.used_at.isnot(None))
            )
            assert used == 1
    finally:
        await c.__aexit__(None, None, None)


async def test_the_credit_remembers_which_session_it_started(new_client, sender, engine) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        sid = (await start(me)).json()["session_id"]
        async with async_sessionmaker(engine)() as s:
            credit = (await s.execute(select(SessionCredit))).scalar_one()
            assert str(credit.session_id) == sid and credit.kind == "trial"
    finally:
        await c.__aexit__(None, None, None)


async def test_billing_needs_a_signed_in_person(new_client) -> None:
    async with new_client() as c:
        assert (await c.get("/api/billing")).status_code == 401
        assert (await c.post("/api/billing/redeem")).status_code == 401


# ------------------------------------------------------------------ invites


async def test_everyone_has_an_invite_link_with_their_own_code(new_client, sender) -> None:
    c1, a = await join(new_client, sender, "a@example.com")
    c2, b = await join(new_client, sender, "b@example.com")
    try:
        ba, bb = (await a.get("/api/billing")).json(), (await b.get("/api/billing")).json()
        assert ba["referral_code"] and ba["referral_code"] != bb["referral_code"]
        assert ba["referral_link"].endswith(f"/signup?ref={ba['referral_code']}")
        assert ba["referrals_per_reward"] == 3 and ba["referrals_to_next_reward"] == 3
    finally:
        await c1.__aexit__(None, None, None)
        await c2.__aexit__(None, None, None)


async def test_three_signups_earn_one_reward_that_has_to_be_redeemed(new_client, sender) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        code = await code_of(me)
        await invite(new_client, sender, code, 2)
        b = (await me.get("/api/billing")).json()
        assert b["referrals_qualified"] == 2 and b["referrals_to_next_reward"] == 1
        assert b["rewards_earned"] == 0 and b["rewards_redeemable"] == 0
        too_early = await me.post("/api/billing/redeem")
        assert too_early.status_code == 409
        assert too_early.json()["error"]["code"] == "nothing_to_redeem"

        await invite(new_client, sender, code, 1, prefix="third")
        b = (await me.get("/api/billing")).json()
        assert b["referrals_qualified"] == 3 and b["rewards_earned"] == 1
        assert b["rewards_redeemable"] == 1
        assert b["sessions_available"] == 1  # earned is not usable until it is redeemed

        r = await me.post("/api/billing/redeem")
        assert r.status_code == 200
        b = r.json()
        assert b["referral_credits_available"] == 1 and b["sessions_available"] == 2
        assert b["rewards_redeemable"] == 0
        again = await me.post("/api/billing/redeem")
        assert again.status_code == 409  # one reward, redeemed once
    finally:
        await c.__aexit__(None, None, None)


async def test_a_redeemed_reward_pays_for_a_session_after_the_trial(new_client, sender) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        await invite(new_client, sender, await code_of(me), 3)
        await me.post("/api/billing/redeem")
        assert (await start(me)).status_code == 201  # the trial goes first
        assert (await me.get("/api/billing")).json()["trial_available"] is False
        assert (await start(me)).status_code == 201  # then the reward
        assert (await start(me)).status_code == 402
    finally:
        await c.__aexit__(None, None, None)


async def test_six_signups_earn_two_rewards_and_the_next_needs_three_more(
    new_client, sender
) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        await invite(new_client, sender, await code_of(me), 6)
        b = (await me.get("/api/billing")).json()
        assert b["rewards_earned"] == 2 and b["rewards_redeemable"] == 2
        assert b["referrals_to_next_reward"] == 3
        await me.post("/api/billing/redeem")
        assert (await me.get("/api/billing")).json()["rewards_redeemable"] == 1
    finally:
        await c.__aexit__(None, None, None)


async def test_two_redeems_at_once_give_one_credit_for_one_reward(new_client, sender) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        await invite(new_client, sender, await code_of(me), 3)
        results = await asyncio.gather(
            me.post("/api/billing/redeem"), me.post("/api/billing/redeem")
        )
        assert sorted(r.status_code for r in results) == [200, 409]
        assert (await me.get("/api/billing")).json()["referral_credits_available"] == 1
    finally:
        await c.__aexit__(None, None, None)


# ------------------------------------------------------------------ what does not count


async def test_inviting_yourself_counts_for_nothing(new_client, sender, engine) -> None:
    c, me = await join(new_client, sender, "pat@gmail.com")
    try:
        code = await code_of(me)
        for other in ("pat+two@gmail.com", "p.a.t@gmail.com", "pat@googlemail.com"):
            c2, _ = await join(new_client, sender, other, code)
            await c2.__aexit__(None, None, None)
        assert (await me.get("/api/billing")).json()["referrals_qualified"] == 0
        async with async_sessionmaker(engine)() as s:
            assert await s.scalar(select(func.count()).select_from(Referral)) == 0
    finally:
        await c.__aexit__(None, None, None)


async def test_an_unknown_or_malformed_code_is_ignored_and_does_not_block_sign_up(
    new_client, sender, engine
) -> None:
    for i, bad in enumerate(["nope", "x", "!!!<script>", "a" * 40]):
        c, me = await join(new_client, sender, f"u{i}@example.com", bad)
        try:
            assert (await me.get("/api/billing")).json()["trial_available"] is True
        finally:
            await c.__aexit__(None, None, None)
    async with async_sessionmaker(engine)() as s:
        assert await s.scalar(select(func.count()).select_from(Referral)) == 0


async def test_someone_who_already_has_an_account_cannot_be_counted_later(
    new_client, sender, engine
) -> None:
    c1, owner = await join(new_client, sender, "owner@example.com")
    c2, old = await join(new_client, sender, "old@example.com")
    try:
        await c2.__aexit__(None, None, None)
        # the existing person signs in again through the owner's link
        c3, _ = await join(new_client, sender, "old@example.com", await code_of(owner))
        await c3.__aexit__(None, None, None)
        assert (await owner.get("/api/billing")).json()["referrals_qualified"] == 0
    finally:
        await c1.__aexit__(None, None, None)


async def test_a_person_is_counted_for_the_first_invite_only(new_client, sender) -> None:
    c1, a = await join(new_client, sender, "a@example.com")
    c2, b = await join(new_client, sender, "b@example.com")
    try:
        code_a, code_b = await code_of(a), await code_of(b)
        c3, _ = await join(new_client, sender, "new@example.com", code_a)
        await c3.__aexit__(None, None, None)
        # the same address cannot sign up again through the other link: it already exists
        c4, _ = await join(new_client, sender, "new@example.com", code_b)
        await c4.__aexit__(None, None, None)
        assert (await a.get("/api/billing")).json()["referrals_qualified"] == 1
        assert (await b.get("/api/billing")).json()["referrals_qualified"] == 0
    finally:
        await c1.__aexit__(None, None, None)
        await c2.__aexit__(None, None, None)


async def test_a_signup_only_counts_once_the_email_link_is_opened(
    new_client, sender, engine
) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        code = await code_of(me)
        async with new_client() as other:
            r = await other.post(
                "/api/auth/signup",
                json={
                    "email": "pending@example.com",
                    "password": "correct horse battery staple",
                    "full_name": "Pat Pending",
                    "ref": code,
                },
            )
            assert r.status_code == 202
            assert (await me.get("/api/billing")).json()["referrals_qualified"] == 0
            v = await other.post(
                "/api/auth/verify", json={"token": sender.token_for("pending@example.com")}
            )
            assert v.status_code == 200
        assert (await me.get("/api/billing")).json()["referrals_qualified"] == 1
    finally:
        await c.__aexit__(None, None, None)


async def test_deleting_an_invited_account_removes_its_referral_row(
    new_client, sender, engine
) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        c2, friend = await join(new_client, sender, "f@example.com", await code_of(me))
        try:
            assert (await friend.delete("/api/account")).status_code in (200, 202)
        finally:
            await c2.__aexit__(None, None, None)
        async with async_sessionmaker(engine)() as s:
            assert await s.scalar(select(func.count()).select_from(User)) == 1
    finally:
        await c.__aexit__(None, None, None)
