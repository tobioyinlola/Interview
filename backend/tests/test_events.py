"""The platform event log: what is written for each action, and that the log never gets in the way."""

import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.adapters.email import AuditedEmailSender, EmailMessage
from app.config import Settings
from app.models import Event, User
from app.services.events import EVENT_KINDS, purge_old_events, record_event
from tests.conftest import TEST_DB
from tests.test_billing import code_of, join


@pytest.fixture
def settings() -> Settings:
    return Settings(  # type: ignore[call-overload,no-any-return]
        environment="local",
        database_url=TEST_DB,
        cookie_secret="test-secret",
        enforce_session_credits=True,
    )


async def events(engine, kind: str | None = None) -> list[Event]:  # type: ignore[no-untyped-def]
    async with async_sessionmaker(engine)() as s:
        q = select(Event).order_by(Event.created_at)
        if kind:
            q = q.where(Event.kind == kind)
        return list((await s.execute(q)).scalars())


# ------------------------------------------------------------------ the recorder


async def test_an_event_holds_who_what_and_plain_facts(engine) -> None:
    sf = async_sessionmaker(engine, expire_on_commit=False)
    uid = uuid.uuid4()
    await record_event(sf, "session.ended", user_id=None, seconds=125, questions=3, session=uid)
    (e,) = await events(engine)
    assert e.kind == "session.ended" and e.user_id is None
    assert e.data == {"seconds": 125, "questions": 3, "session": str(uid)}


async def test_long_text_and_odd_values_are_cut_down_and_made_safe(engine) -> None:
    sf = async_sessionmaker(engine, expire_on_commit=False)
    await record_event(
        sf, "company.added", name="x" * 5000, tags=list(range(100)), nested={"a": object()}
    )
    (e,) = await events(engine)
    assert len(e.data["name"]) == 200 and len(e.data["tags"]) == 20
    assert isinstance(e.data["nested"]["a"], str)


async def test_recording_never_raises_even_when_the_database_is_gone() -> None:
    from sqlalchemy.ext.asyncio import create_async_engine

    dead = async_sessionmaker(create_async_engine("postgresql+asyncpg://x:y@127.0.0.1:1/none"))
    await record_event(dead, "user.signed_in", user_id=None)  # must simply return


async def test_old_events_are_purged_and_recent_ones_kept(engine) -> None:
    from datetime import UTC, datetime, timedelta

    sf = async_sessionmaker(engine, expire_on_commit=False)
    async with sf() as s:
        s.add(
            Event(
                kind="user.signed_in", created_at=datetime.now(UTC) - timedelta(days=400), data={}
            )
        )
        s.add(
            Event(kind="user.signed_in", created_at=datetime.now(UTC) - timedelta(days=5), data={})
        )
        await s.commit()
    assert await purge_old_events(sf, 180) == 1
    assert len(await events(engine)) == 1


def test_every_kind_the_code_records_is_described_for_the_console() -> None:
    """A kind that is recorded but not in EVENT_KINDS would show up in the console undescribed."""
    app = Path(__file__).resolve().parents[1] / "app"
    used: set[str] = set()
    for path in app.rglob("*.py"):
        text = path.read_text()
        used |= set(
            re.findall(
                r'record_(?:from|event)\(\s*(?:db|self\.sf|self\._sf|sf)\s*,\s*"([a-z_.]+)"', text
            )
        )
        used |= set(
            re.findall(
                r'"((?:user|auth|onboarding|tour|cv|company|research|session|scoring|answer|referral|reward|email|admin)\.[a-z_]+)"',
                text,
            )
        )
    not_events = {"session.update"}  # a provider protocol message that only looks like one
    missing = {k for k in used if k not in EVENT_KINDS and k not in not_events}
    assert not missing, missing


def test_every_described_kind_has_a_category_and_a_label() -> None:
    for kind, (category, label) in EVENT_KINDS.items():
        assert category and label and "." in kind


# ------------------------------------------------------------------ what each action writes


async def test_signing_up_by_email_link_is_logged_with_how_they_came(
    new_client, sender, engine
) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        (e,) = await events(engine, "user.signed_up")
        assert e.data["method"] == "email_link" and e.data["referred"] is False
        async with async_sessionmaker(engine)() as s:
            user = (await s.execute(select(User))).scalar_one()
            assert user.attribution == {"method": "email_link", "referred": False}
    finally:
        await c.__aexit__(None, None, None)


async def test_a_password_sign_up_remembers_its_campaign_tags(new_client, sender, engine) -> None:
    async with new_client() as c:
        r = await c.post(
            "/api/auth/signup",
            json={
                "email": "p@example.com",
                "password": "correct horse battery staple!",
                "full_name": "Pat Rivera",
                "utm": {"source": "linkedin", "medium": "social", "campaign": "launch-week"},
            },
        )
        assert r.status_code == 202
        await c.post("/api/auth/verify", json={"token": sender.token_for("p@example.com")})
    (e,) = await events(engine, "user.signed_up")
    assert e.data["method"] == "password" and e.data["utm_source"] == "linkedin"
    async with async_sessionmaker(engine)() as s:
        user = (await s.execute(select(User))).scalar_one()
        assert user.attribution["utm_campaign"] == "launch-week"
        assert user.attribution["method"] == "password"


async def test_campaign_tags_are_cleaned_and_bounded(new_client, sender, engine) -> None:
    async with new_client() as c:
        await c.post(
            "/api/auth/request-link",
            json={
                "email": "t@example.com",
                "utm": {"source": "<script>x</script>", "medium": "a" * 200},
            },
        )  # an over-long tag is refused, a markup tag is cleaned
    # the 200-character tag fails validation, so no link was made
    assert sender.links == []
    async with new_client() as c:
        await c.post(
            "/api/auth/request-link",
            json={"email": "t@example.com", "utm": {"source": "<script>x</script>"}},
        )
        await c.post("/api/auth/verify", json={"token": sender.token_for("t@example.com")})
    (e,) = await events(engine, "user.signed_up")
    assert e.data["utm_source"] == "scriptxscript"


async def test_signing_in_again_and_a_wrong_password_are_logged(new_client, sender, engine) -> None:
    async with new_client() as c:
        await c.post(
            "/api/auth/signup",
            json={
                "email": "p@example.com",
                "password": "correct horse battery staple!",
                "full_name": "Pat Rivera",
            },
        )
        await c.post("/api/auth/verify", json={"token": sender.token_for("p@example.com")})
        await c.post("/api/auth/logout")
        bad = await c.post(
            "/api/auth/login", json={"email": "p@example.com", "password": "nope nope nope"}
        )
        assert bad.status_code == 401
        ok = await c.post(
            "/api/auth/login",
            json={"email": "p@example.com", "password": "correct horse battery staple!"},
        )
        assert ok.status_code == 200
    assert [e.data["method"] for e in await events(engine, "user.signed_in")] == ["password"]
    (failed,) = await events(engine, "auth.login_failed")
    assert failed.data["email"] == "p@example.com" and failed.user_id is not None


async def test_the_events_never_carry_a_password_or_a_token(new_client, sender, engine) -> None:
    async with new_client() as c:
        await c.post(
            "/api/auth/signup",
            json={
                "email": "p@example.com",
                "password": "correct horse battery staple!",
                "full_name": "Pat Rivera",
            },
        )
        tok = sender.token_for("p@example.com")
        await c.post("/api/auth/verify", json={"token": tok})
        await c.post(
            "/api/auth/login", json={"email": "p@example.com", "password": "wrong wrong wrong"}
        )
    blob = " ".join(str(e.data) for e in await events(engine))
    assert "correct horse" not in blob and "wrong wrong" not in blob and tok not in blob


async def test_onboarding_the_tour_a_cv_and_a_company_are_logged(
    new_client, sender, engine
) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        assert (await me.put("/api/onboarding", json={"skipped": True})).status_code == 200
        await me.put("/api/tour", json={"done": True})
        await me.post(
            "/api/notes/cv",
            content=b"Led the 2025 launch at Acme.",
            headers={"x-filename": "cv.txt", "content-type": "text/plain"},
        )
        await me.delete("/api/notes/cv")
        await me.post(
            "/api/companies",
            json={"name": "Northwind", "role": "PM", "extra_links": [], "known_text": ""},
        )
    finally:
        await c.__aexit__(None, None, None)
    got = {e.kind for e in await events(engine)}
    assert {"onboarding.skipped", "tour.done", "cv.uploaded", "cv.removed", "company.added"} <= got
    (up,) = await events(engine, "cv.uploaded")
    assert up.data["characters"] > 0 and "Acme" not in str(up.data)  # counts only, never the text


async def test_sessions_are_logged_from_start_to_end_and_when_blocked(
    new_client, sender, engine
) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        sid = (await me.post("/api/sessions", json={})).json()["session_id"]
        assert (await me.post("/api/sessions", json={})).status_code == 402
        assert (await me.post(f"/api/sessions/{sid}/end")).status_code == 200
        await me.post(f"/api/sessions/{sid}/end")  # ending twice is not a second event
    finally:
        await c.__aexit__(None, None, None)
    (started,) = await events(engine, "session.started")
    assert started.data["credit"] == "trial" and started.data["session_id"] == sid
    assert len(await events(engine, "session.blocked")) == 1
    (ended,) = await events(engine, "session.ended")
    assert ended.data["session_id"] == sid and ended.data["seconds"] >= 0


async def test_a_friend_joining_is_logged_and_tells_the_inviter(new_client, sender, engine) -> None:
    c, me = await join(new_client, sender, "owner@example.com")
    try:
        code = await code_of(me)
        c2, _ = await join(new_client, sender, "friend@example.com", code)
        await c2.__aexit__(None, None, None)
    finally:
        await c.__aexit__(None, None, None)
    (e,) = await events(engine, "referral.counted")
    assert e.user_id is not None  # logged against the inviter
    (mail,) = [m for m in sender.messages if m.kind == "friend_joined"]
    assert mail.to == "owner@example.com" and "1 of 3" in mail.text


async def test_the_third_friend_earns_a_reward_email_and_redeeming_is_logged(
    new_client, sender, engine
) -> None:
    c, me = await join(new_client, sender, "owner@example.com")
    try:
        code = await code_of(me)
        for i in range(3):
            c2, _ = await join(new_client, sender, f"f{i}@example.com", code)
            await c2.__aexit__(None, None, None)
        assert sender.kinds("owner@example.com").count("friend_joined") == 2
        assert sender.kinds("owner@example.com").count("reward_earned") == 1
        assert (await me.post("/api/billing/redeem")).status_code == 200
    finally:
        await c.__aexit__(None, None, None)
    assert len(await events(engine, "reward.redeemed")) == 1


async def test_a_held_signup_is_logged_but_the_inviter_is_not_emailed(
    new_client, sender, engine
) -> None:
    async with new_client() as me:
        await me.post("/api/auth/request-link", json={"email": "owner@example.com"})
        await me.post("/api/auth/verify", json={"token": sender.token_for("owner@example.com")})
        code = await code_of(me)
        await me.post("/api/auth/logout")
        await me.post("/api/auth/request-link", json={"email": "alt@example.org", "ref": code})
        await me.post("/api/auth/verify", json={"token": sender.token_for("alt@example.org")})
    assert len(await events(engine, "referral.held")) == 1
    assert "friend_joined" not in sender.kinds() and "reward_earned" not in sender.kinds()


async def test_the_free_interview_ending_sends_one_nudge_only(new_client, sender, engine) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        sid = (await me.post("/api/sessions", json={})).json()["session_id"]
        await me.post(f"/api/sessions/{sid}/end")
        await me.post(f"/api/sessions/{sid}/end")
        assert sender.kinds("a@example.com").count("trial_used") == 1
    finally:
        await c.__aexit__(None, None, None)


async def test_no_nudge_while_the_person_still_has_an_interview_left(
    new_client, sender, engine
) -> None:
    c, me = await join(new_client, sender, "owner@example.com")
    try:
        code = await code_of(me)
        for i in range(3):
            c2, _ = await join(new_client, sender, f"f{i}@example.com", code)
            await c2.__aexit__(None, None, None)
        await me.post("/api/billing/redeem")
        sid = (await me.post("/api/sessions", json={})).json()["session_id"]
        await me.post(f"/api/sessions/{sid}/end")
        assert "trial_used" not in sender.kinds("owner@example.com")  # a reward session is left
    finally:
        await c.__aexit__(None, None, None)


async def test_deleting_an_account_removes_its_events_but_keeps_that_it_happened(
    new_client, sender, engine
) -> None:
    c, me = await join(new_client, sender, "a@example.com")
    try:
        await me.put("/api/tour", json={"done": True})
        assert (await me.delete("/api/account")).status_code == 202
    finally:
        await c.__aexit__(None, None, None)
    got = await events(engine)
    assert [e.kind for e in got] == ["user.deleted"] and got[0].user_id is None
    assert "a@example.com" not in str(got[0].data)


# ------------------------------------------------------------------ the email wrapper


class Inner:
    def __init__(self, result: bool | None) -> None:
        self.result = result

    async def send(self, message: EmailMessage) -> bool | None:
        return self.result


def msg(to: str = "x@example.com", kind: str = "welcome") -> EmailMessage:
    return EmailMessage(
        kind=kind, to=to, subject="s", html="<p>SECRET BODY</p>", text="SECRET BODY"
    )


async def test_every_email_outcome_is_logged_without_its_body(engine) -> None:
    sf = async_sessionmaker(engine, expire_on_commit=False)
    async with sf() as s:
        s.add(User(email="x@example.com"))
        await s.commit()
    await AuditedEmailSender(Inner(True), sf).send(msg())
    await AuditedEmailSender(Inner(False), sf).send(msg(kind="reset"))
    await AuditedEmailSender(Inner(None), sf).send(msg(kind="login"))  # unknown counts as sent
    got = await events(engine)
    assert [(e.kind, e.data["email_kind"]) for e in got] == [
        ("email.sent", "welcome"),
        ("email.failed", "reset"),
        ("email.sent", "login"),
    ]
    assert all(e.user_id is not None for e in got)  # tied to the account that has that address
    assert "SECRET BODY" not in str([e.data for e in got])


async def test_an_email_to_someone_without_an_account_is_logged_without_a_user(engine) -> None:
    sf = async_sessionmaker(engine, expire_on_commit=False)
    await AuditedEmailSender(Inner(True), sf).send(msg("new@example.com", "signup"))
    (e,) = await events(engine)
    assert e.user_id is None and e.data["to"] == "new@example.com"


async def test_the_wrapper_returns_what_the_real_sender_said_and_survives_a_dead_log(
    engine,
) -> None:
    from sqlalchemy.ext.asyncio import create_async_engine

    dead = async_sessionmaker(create_async_engine("postgresql+asyncpg://x:y@127.0.0.1:1/none"))
    assert await AuditedEmailSender(Inner(False), dead).send(msg()) is False
    assert await AuditedEmailSender(Inner(True), dead).send(msg()) is True


async def test_logging_does_not_change_what_a_request_returns(
    new_client, sender, engine, monkeypatch
) -> None:
    import app.routers.auth as auth_router

    async def boom(*a, **k):  # the log is down
        raise RuntimeError("down")

    # record_from swallows everything itself; make the inner write fail to prove it
    monkeypatch.setattr(
        "app.services.events.Event", lambda **k: (_ for _ in ()).throw(RuntimeError("x"))
    )
    c, me = await join(new_client, sender, "a@example.com")
    try:
        assert (await me.get("/api/me")).status_code == 200
    finally:
        await c.__aexit__(None, None, None)
    assert await events(engine) == []  # nothing was written, and nothing broke
    assert auth_router is not None and boom is not None


async def test_the_count_of_events_by_kind(engine) -> None:
    sf = async_sessionmaker(engine, expire_on_commit=False)
    for _ in range(3):
        await record_event(sf, "user.signed_in", method="password")
    async with sf() as s:
        n = await s.scalar(
            select(func.count()).select_from(Event).where(Event.kind == "user.signed_in")
        )
    assert n == 3
