import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import Note, User
from app.services.names import clean_name, first_name

PASSWORD = "correct horse battery staple!"
EMAIL = "jordan@example.com"
ANSWERS = {
    "goal": "new_job",
    "level": "senior",
    "timeline": "few_weeks",
    "focus": ["structure", "results"],
}


# ------------------------------------------------------------------ names


@pytest.mark.parametrize(
    "raw, clean",
    [
        ("Jordan Reyes", "Jordan Reyes"),
        ("  Jordan    Reyes  ", "Jordan Reyes"),
        ("José María O'Neil-Smith", "José María O'Neil-Smith"),
        ("Zoë Ångström", "Zoë Ångström"),
        ("李小龍", "李小龍"),
        ("Анна Иванова", "Анна Иванова"),
        ("Dr. Ada Lovelace, Jr.", "Dr. Ada Lovelace, Jr."),
        ("O’Brien", "O’Brien"),
        ("émile", "émile"),  # accents are normalised to one form
    ],
)
def test_real_names_are_kept_and_tidied(raw: str, clean: str) -> None:
    assert clean_name(raw) == clean


@pytest.mark.parametrize(
    "raw",
    [
        None, "", "   ", "1234", "Jordan<script>", "a@b.com", "Jordan; DROP TABLE", "x" * 121,
        "Jordan\x00Reyes", "Jordan\u202eReyes", "\U0001f44b", "$$$",
        "Jo\nrdan\r\nBcc:x@evil.example",  # a header-injection attempt: the colon alone refuses it
        "...", "'-'", ", ,", "-", "\u2019\u2019",  # punctuation alone is not a name
    ],
)  # fmt: skip
def test_things_that_are_not_names_are_refused(raw: str | None) -> None:
    assert clean_name(raw) is None


def test_plain_line_breaks_between_words_become_single_spaces() -> None:
    assert clean_name("Jordan\nReyes") == "Jordan Reyes"  # never a line break inside a name


@pytest.mark.parametrize(
    "full, first",
    [("Jordan Reyes", "Jordan"), ("Ada", "Ada"), ("Dr. Ada Lovelace", "Dr"), (None, None), ("", None)],
)  # fmt: skip
def test_first_name_is_the_first_word(full: str | None, first: str | None) -> None:
    assert first_name(full) == first


# ------------------------------------------------------------------ signup carries the name


async def signup(c, email=EMAIL, name="Jordan Reyes"):  # type: ignore[no-untyped-def]
    return await c.post(
        "/api/auth/signup", json={"email": email, "password": PASSWORD, "full_name": name}
    )


async def confirm(c, sender, email=EMAIL):  # type: ignore[no-untyped-def]
    return await c.post("/api/auth/verify", json={"token": sender.token_for(email)})


async def test_signup_requires_a_full_name(new_client, sender) -> None:
    async with new_client() as c:
        missing = await c.post("/api/auth/signup", json={"email": EMAIL, "password": PASSWORD})
        blank = await signup(c, name="   ")
    assert missing.status_code == 422 and blank.status_code == 422
    assert blank.json()["error"]["code"] == "invalid_name" and sender.messages == []


@pytest.mark.parametrize("bad", ["1234", "<b>Jo</b>", "Jo@x.com", "x" * 121])
async def test_a_bad_name_is_refused_with_a_message_and_sends_nothing(
    new_client, sender, bad: str
) -> None:
    async with new_client() as c:
        r = await signup(c, name=bad)
    assert r.status_code == 422 and "full name" in r.json()["error"]["message"]
    assert sender.messages == []


async def test_the_name_arrives_with_the_account_and_greets_in_the_confirmation_email(
    new_client, sender
) -> None:
    async with new_client() as c:
        await signup(c, name="  José   García ")
        confirmation = sender.messages[0]
        me = (await confirm(c, sender)).json()
    assert "Hi José," in confirmation.text and "Welcome, José." in confirmation.text.title()
    assert me["full_name"] == "José García"
    async with new_client() as c2:
        await c2.post("/api/auth/request-link", json={"email": EMAIL})
        await confirm(c2, sender)
        assert (await c2.get("/api/me")).json()["full_name"] == "José García"


async def test_a_name_from_a_stranger_signup_cannot_land_on_an_account_made_meanwhile(
    new_client, sender, sign_in
) -> None:
    async with new_client() as stranger:
        await signup(stranger, name="Mallory Mallet")  # no account yet, so a sign-up token is made
        planted = sender.token_for(EMAIL)
    async with new_client() as owner:
        await sign_in(owner, EMAIL)  # the real owner creates the account another way
        await owner.post("/api/auth/verify", json={"token": planted})  # and opens the stray link
        assert (await owner.get("/api/me")).json()["full_name"] is None


async def test_a_stranger_cannot_set_the_name_on_an_existing_account(
    new_client, sender, sign_in
) -> None:
    async with new_client() as owner:
        await sign_in(owner, EMAIL)  # account exists, no name
    async with new_client() as stranger:
        await signup(stranger, name="Mallory Mallet")
        await confirm(stranger, sender)
        assert (await stranger.get("/api/me")).json()["full_name"] is None


# ------------------------------------------------------------------ the emails around the account


async def test_a_new_account_gets_one_welcome_email_with_its_first_name(new_client, sender) -> None:
    async with new_client() as c:
        await signup(c)
        await confirm(c, sender)
    assert sender.kinds(EMAIL) == ["signup", "welcome"]
    welcome = sender.messages[1]
    assert welcome.subject == "Welcome to InterviewMeet, Jordan" and welcome.link is None


async def test_signing_in_again_does_not_send_another_welcome(new_client, sender) -> None:
    async with new_client() as c:
        await signup(c)
        await confirm(c, sender)
    async with new_client() as c2:
        await c2.post("/api/auth/request-link", json={"email": EMAIL})
        await confirm(c2, sender)
    assert sender.kinds(EMAIL).count("welcome") == 1


async def test_the_sign_in_and_reset_emails_greet_a_known_person_by_name(
    new_client, sender
) -> None:
    async with new_client() as c:
        await signup(c)
        await confirm(c, sender)
        await c.post("/api/auth/request-link", json={"email": EMAIL})
        await c.post("/api/auth/request-reset", json={"email": EMAIL})
    login = [m for m in sender.messages if m.kind == "login"][0]
    reset = [m for m in sender.messages if m.kind == "reset"][0]
    assert "Hi Jordan," in login.text and "Hi Jordan," in reset.text


async def test_changing_the_password_sends_a_security_notice_but_a_failed_reset_does_not(
    new_client, sender
) -> None:
    async with new_client() as c:
        await signup(c)
        await confirm(c, sender)
        await c.post("/api/auth/request-reset", json={"email": EMAIL})
        token = sender.token_for(EMAIL)
        weak = await c.post("/api/auth/reset-password", json={"token": token, "password": "short"})
        assert weak.status_code == 422 and "password_changed" not in sender.kinds(EMAIL)
        ok = await c.post(
            "/api/auth/reset-password", json={"token": token, "password": "a brand new passphrase!"}
        )
    assert ok.status_code == 200
    notice = [m for m in sender.messages if m.kind == "password_changed"]
    assert len(notice) == 1 and notice[0].to == EMAIL and notice[0].link is None
    assert "UTC" in notice[0].text and "Hi Jordan," in notice[0].text


async def test_deleting_the_account_sends_one_confirmation_after_the_data_is_gone(
    new_client, sender, engine
) -> None:
    async with new_client() as c:
        await signup(c)
        await confirm(c, sender)
        r = await c.delete("/api/account")
        assert r.status_code == 202
        assert (await c.get("/api/me")).status_code == 401
    assert sender.kinds(EMAIL)[-1] == "account_deleted"
    bye = sender.messages[-1]
    assert bye.to == EMAIL and bye.link is None and "Hi Jordan," in bye.text
    async with async_sessionmaker(engine)() as s:
        assert (await s.execute(select(User))).first() is None


async def test_no_email_is_sent_for_the_failed_attempts_that_should_stay_quiet(
    new_client, sender
) -> None:
    async with new_client() as c:
        await c.post("/api/auth/request-reset", json={"email": "ghost@example.com"})
        await c.post("/api/auth/login", json={"email": "ghost@example.com", "password": "x"})
    assert sender.messages == []


# ------------------------------------------------------------------ me, profile, onboarding


async def test_a_new_account_has_not_been_onboarded_and_me_says_so(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        me = (await c.get("/api/me")).json()
    assert me["onboarded"] is False and me["onboarding"] is None and me["full_name"] is None


async def test_finishing_onboarding_saves_the_four_answers(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        r = await c.put("/api/onboarding", json=ANSWERS)
        me = (await c.get("/api/me")).json()
    assert r.status_code == 200 and r.json() == me
    assert me["onboarded"] is True and me["onboarding"] == ANSWERS


async def test_skipping_onboarding_is_remembered_and_keeps_any_partial_answers(
    new_client, sign_in
) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        r = await c.put("/api/onboarding", json={"skipped": True, "goal": "promotion"})
    assert r.json()["onboarded"] is True and r.json()["onboarding"]["goal"] == "promotion"
    async with new_client() as c2:
        await sign_in(c2, "other@example.com")
        r2 = await c2.put("/api/onboarding", json={"skipped": True})
    assert r2.json()["onboarded"] is True and r2.json()["onboarding"] is None


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"goal": "new_job", "level": "senior", "timeline": "few_weeks"},  # no focus
        {"goal": "new_job", "level": "senior", "focus": ["structure"]},  # no timeline
        {"level": "senior", "timeline": "few_weeks", "focus": ["structure"]},  # no goal
    ],
)
async def test_an_incomplete_onboarding_is_refused_unless_skipped(
    new_client,
    sign_in,
    body: dict,  # type: ignore[type-arg]
) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        r = await c.put("/api/onboarding", json=body)
        me = (await c.get("/api/me")).json()
    assert r.status_code == 422 and r.json()["error"]["code"] == "onboarding_incomplete"
    assert me["onboarded"] is False


@pytest.mark.parametrize(
    "patch",
    [
        {"goal": "retire"},
        {"level": "god"},
        {"timeline": "yesterday"},
        {"focus": ["structure", "results", "confidence", "technical"]},  # more than three
        {"focus": ["nonsense"]},
    ],
)
async def test_answers_outside_the_allowed_choices_are_refused(
    new_client,
    sign_in,
    patch: dict,  # type: ignore[type-arg]
) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        r = await c.put("/api/onboarding", json={**ANSWERS, **patch})
    assert r.status_code == 422


async def test_repeated_focus_areas_are_stored_once(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        r = await c.put(
            "/api/onboarding", json={**ANSWERS, "focus": ["results", "structure", "results"]}
        )
    assert r.json()["onboarding"]["focus"] == ["results", "structure"]


async def test_the_target_role_from_onboarding_lands_on_the_cv_page(
    new_client, sign_in, engine
) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        await c.put("/api/onboarding", json={**ANSWERS, "role": "  Senior Product Manager "})
        notes = (await c.get("/api/notes")).json()
    assert notes["role"] == "Senior Product Manager"
    async with async_sessionmaker(engine)() as s:
        assert (await s.execute(select(Note.role))).scalar_one() == "Senior Product Manager"


async def test_onboarding_can_supply_a_missing_name_and_refuses_a_bad_one(
    new_client, sign_in
) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        bad = await c.put("/api/onboarding", json={**ANSWERS, "full_name": "1234"})
        assert bad.status_code == 422 and (await c.get("/api/me")).json()["onboarded"] is False
        ok = await c.put("/api/onboarding", json={**ANSWERS, "full_name": " ada  lovelace "})
    assert ok.json()["full_name"] == "ada lovelace"


async def test_doing_onboarding_again_keeps_the_first_completion_time(
    new_client, sign_in, engine
) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        await c.put("/api/onboarding", json=ANSWERS)
        async with async_sessionmaker(engine)() as s:
            first = (await s.execute(select(User.onboarded_at))).scalar_one()
        await c.put("/api/onboarding", json={**ANSWERS, "goal": "practice"})
        async with async_sessionmaker(engine)() as s:
            row = (await s.execute(select(User))).scalar_one()
    assert row.onboarded_at == first and row.onboarding["goal"] == "practice"


async def test_the_profile_name_can_be_changed_and_must_be_a_name(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        ok = await c.put("/api/profile", json={"full_name": "Jordan  Reyes"})
        bad = await c.put("/api/profile", json={"full_name": "<b>"})
        empty = await c.put("/api/profile", json={"full_name": ""})
    assert ok.json()["full_name"] == "Jordan Reyes"
    assert bad.status_code == 422 and empty.status_code == 422


async def test_profile_and_onboarding_are_private_and_need_sign_in(new_client, sign_in) -> None:
    async with new_client() as anon:
        assert (await anon.put("/api/onboarding", json=ANSWERS)).status_code == 401
        assert (await anon.put("/api/profile", json={"full_name": "Jo"})).status_code == 401
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        await a.put("/api/onboarding", json=ANSWERS)
        assert (await b.get("/api/me")).json()["onboarded"] is False


async def test_the_csrf_header_is_required_on_the_new_writes(new_client, sign_in) -> None:
    async with new_client() as c:
        await sign_in(c, EMAIL)
        bad = {"x-requested-with": "nope"}
        assert (await c.put("/api/onboarding", json=ANSWERS, headers=bad)).status_code == 403
        assert (
            await c.put("/api/profile", json={"full_name": "Jo"}, headers=bad)
        ).status_code == 403
