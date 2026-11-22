import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import AuthSession, LoginFailure, LoginToken, User
from app.services.passwords import (
    hash_password,
    password_problem,
    verify_password,
    verify_password_async,
)

GOOD = "correct horse battery staple"
EMAIL = "pat@example.com"


# ------------------------------------------------------------------ hashing and rules


def test_hashes_are_salted_and_verify_only_the_right_password() -> None:
    a, b = hash_password(GOOD), hash_password(GOOD)
    assert a != b and a.startswith("scrypt$") and GOOD not in a
    assert verify_password(GOOD, a) and verify_password(GOOD, b)
    assert not verify_password(GOOD + "x", a) and not verify_password("", a)


@pytest.mark.parametrize(
    "stored", ["", "garbage", "scrypt$1$2$3$4", "bcrypt$a$b$c$d$e", "scrypt$x$8$1$AA==$AA=="]
)
def test_a_malformed_stored_hash_never_verifies_and_never_raises(stored: str) -> None:
    assert verify_password(GOOD, stored) is False


async def test_an_account_with_no_password_cannot_log_in_but_costs_the_same_to_check() -> None:
    assert await verify_password_async(GOOD, None) is False


@pytest.mark.parametrize(
    "pw, email, expected",
    [
        ("short", "", "at least 10"),
        ("x" * 129, "", "at most 128"),
        ("password123", "", "too easy"),
        ("PASSWORD123", "", "too easy"),
        ("aaaaaaaaaaaa", "", "too easy"),
        ("abababababab", "", "too easy"),
        ("pat@example.com", "pat@example.com", "email"),
        ("patrick99x", "patrick99x@example.com", "email"),
        (GOOD, "pat@example.com", None),
        ("a" * 128, "", "too easy"),
        ("Tr0ub4dor&3-long", "", None),
        ("pässwörd with ünïcode 🔑", "", None),
    ],
)
def test_password_rules(pw: str, email: str, expected: str | None) -> None:
    problem = password_problem(pw, email)
    assert (problem is None) if expected is None else (expected in (problem or ""))


# ------------------------------------------------------------------ helpers


async def signup(c, email=EMAIL, password=GOOD):  # type: ignore[no-untyped-def]
    return await c.post(
        "/api/auth/signup", json={"email": email, "password": password, "full_name": "Pat Rivera"}
    )


async def confirm(c, sender, email=EMAIL):  # type: ignore[no-untyped-def]
    return await c.post("/api/auth/verify", json={"token": sender.token_for(email)})


async def login(c, email=EMAIL, password=GOOD):  # type: ignore[no-untyped-def]
    return await c.post("/api/auth/login", json={"email": email, "password": password})


async def rows(engine, model):  # type: ignore[no-untyped-def]
    async with async_sessionmaker(engine)() as s:
        return list((await s.execute(select(model))).scalars())


# ------------------------------------------------------------------ sign up


async def test_signup_creates_nothing_until_the_email_link_is_opened(
    new_client, sender, engine
) -> None:
    async with new_client() as c:
        r = await signup(c)
        assert r.status_code == 202 and r.json() == {"status": "sent"}
        assert await rows(engine, User) == []  # no account yet
        assert (await login(c)).status_code == 401  # and the password does not work yet
        v = await confirm(c, sender)
        assert v.status_code == 200 and "httponly" in v.headers["set-cookie"].lower()
        assert (await c.get("/api/me")).json()["email"] == EMAIL


async def test_after_confirming_the_password_logs_in_and_is_stored_only_as_a_hash(
    new_client, sender, engine
) -> None:
    async with new_client() as c:
        await signup(c)
        await confirm(c, sender)
    async with new_client() as other:
        r = await login(other)
        assert r.status_code == 200 and r.json()["email"] == EMAIL
        # only whether one is set is shown (has_password); never the password or its hash
        assert "scrypt" not in r.text and "hash" not in r.text and GOOD not in r.text
        assert r.json()["has_password"] is True
        assert (await other.get("/api/me")).status_code == 200
    (user,) = await rows(engine, User)
    assert (
        user.password_hash
        and user.password_hash.startswith("scrypt$")
        and GOOD not in user.password_hash
    )
    tokens = await rows(engine, LoginToken)
    assert all(GOOD not in (t.password_hash or "") for t in tokens)


@pytest.mark.parametrize("pw", ["short", "password123", "pat@example.com"])
async def test_a_weak_password_is_refused_with_a_reason_and_sends_no_email(
    new_client, sender, pw
) -> None:
    async with new_client() as c:
        r = await signup(c, password=pw)
    assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password"
    assert r.json()["error"]["message"] and sender.links == []


async def test_signup_answers_the_same_for_a_new_and_an_existing_email(
    new_client, sign_in, sender
) -> None:
    async with new_client() as c, new_client() as c2:
        await sign_in(c, "known@example.com")
        a = await signup(c2, "known@example.com")
        b = await signup(c2, "stranger@example.com")
    assert a.status_code == b.status_code == 202 and a.json() == b.json()


async def test_signup_for_an_existing_account_does_not_change_its_password(
    new_client, sender
) -> None:
    async with new_client() as c:
        await signup(c)
        await confirm(c, sender)
    async with new_client() as attacker:
        await signup(attacker, EMAIL, "attacker chosen password")
        await confirm(attacker, sender)  # whoever opens the link is signed in as the owner...
    async with new_client() as owner:
        assert (await login(owner, password="attacker chosen password")).status_code == 401
        assert (await login(owner)).status_code == 200  # ...and the real password is untouched


async def test_a_signup_started_by_a_stranger_cannot_plant_a_password_on_a_real_account(
    new_client, sign_in, sender, engine
) -> None:
    async with new_client() as stranger:
        await signup(stranger, EMAIL, "attacker chosen password")  # token issued, no account yet
        planted = sender.token_for(EMAIL)
    async with new_client() as owner:
        await sign_in(owner, EMAIL)  # the real owner creates the account another way
        await owner.post("/api/auth/verify", json={"token": planted})  # and opens the stray link
    (user,) = await rows(engine, User)
    assert user.password_hash is None
    async with new_client() as c:
        assert (await login(c, password="attacker chosen password")).status_code == 401


async def test_signup_links_are_single_use(new_client, sender) -> None:
    async with new_client() as c:
        await signup(c)
        token = sender.token_for(EMAIL)
        assert (await c.post("/api/auth/verify", json={"token": token})).status_code == 200
        assert (await c.post("/api/auth/verify", json={"token": token})).status_code == 400


async def test_signup_shares_the_hourly_link_limit(new_client, sender, settings) -> None:
    async with new_client() as c:
        codes = [(await signup(c)).status_code for _ in range(settings.login_requests_per_hour + 1)]
    assert codes[:-1] == [202] * settings.login_requests_per_hour and codes[-1] == 429


# ------------------------------------------------------------------ log in


async def make_account(new_client, sender):  # type: ignore[no-untyped-def]
    async with new_client() as c:
        await signup(c)
        await confirm(c, sender)


async def test_email_is_case_insensitive_at_login(new_client, sender) -> None:
    await make_account(new_client, sender)
    async with new_client() as c:
        assert (await login(c, "PAT@Example.com")).status_code == 200


async def test_every_kind_of_failed_login_gets_the_same_answer(new_client, sender, sign_in) -> None:
    await make_account(new_client, sender)
    async with new_client() as c:
        await sign_in(c, "linkonly@example.com")  # an account with no password
    async with new_client() as c:
        wrong = await login(c, EMAIL, "not the password")
        nobody = await login(c, "nobody@example.com", GOOD)
        nopass = await login(c, "linkonly@example.com", GOOD)
    assert wrong.status_code == nobody.status_code == nopass.status_code == 401
    bodies = [
        {k: v for k, v in r.json()["error"].items() if k != "request_id"}
        for r in (wrong, nobody, nopass)
    ]
    assert bodies[0] == bodies[1] == bodies[2]
    assert "incorrect" in wrong.json()["error"]["message"].lower()


async def test_guessing_is_throttled_per_email_even_for_the_right_password(
    new_client, sender, engine
) -> None:
    await make_account(new_client, sender)
    async with new_client() as c:
        for _ in range(10):
            assert (await login(c, password="guess guess guess")).status_code == 401
        locked = await login(c)  # the correct password, but too many wrong ones just happened
        assert locked.status_code == 429 and locked.json()["error"]["code"] == "rate_limited"
        other = await login(c, "someone-else@example.com", GOOD)
        assert other.status_code == 401  # another email is not locked
    assert len(await rows(engine, LoginFailure)) >= 10


async def test_a_successful_login_resets_the_failure_count(new_client, sender, engine) -> None:
    await make_account(new_client, sender)
    async with new_client() as c:
        for _ in range(9):
            await login(c, password="wrong wrong wrong")
        assert (await login(c)).status_code == 200
        for _ in range(9):
            assert (await login(c, password="wrong wrong wrong")).status_code == 401
        assert (await login(c)).status_code == 200  # still not locked: the counter restarted
    assert await rows(engine, LoginFailure) == []


async def test_passwords_never_appear_in_logs(new_client, sender, caplog) -> None:
    secret = "a very unusual passphrase 8841"
    async with new_client() as c:
        await signup(c, password=secret)
        await confirm(c, sender)
        await login(c, password=secret)
        await login(c, password=secret + "x")
    text = " ".join(r.getMessage() + str(getattr(r, "fields", "")) for r in caplog.records)
    assert secret not in text and "8841" not in text


# ------------------------------------------------------------------ reset


async def test_reset_for_an_unknown_email_sends_nothing_but_answers_the_same(
    new_client, sender
) -> None:
    await make_account(new_client, sender)
    sender.links.clear()
    async with new_client() as c:
        known = await c.post("/api/auth/request-reset", json={"email": EMAIL})
        unknown = await c.post("/api/auth/request-reset", json={"email": "ghost@example.com"})
    assert known.status_code == unknown.status_code == 202 and known.json() == unknown.json()
    assert [e for e, _ in sender.links] == [EMAIL]
    assert "reset-password?token=" in sender.links[0][1]


async def test_reset_sets_a_new_password_signs_in_and_signs_every_other_session_out(
    new_client, sender
) -> None:
    await make_account(new_client, sender)
    async with new_client() as old_device:
        await login(old_device)
        assert (await old_device.get("/api/me")).status_code == 200
        async with new_client() as c:
            await c.post("/api/auth/request-reset", json={"email": EMAIL})
            r = await c.post(
                "/api/auth/reset-password",
                json={"token": sender.token_for(EMAIL), "password": "a brand new passphrase"},
            )
            assert r.status_code == 200 and (await c.get("/api/me")).status_code == 200
        assert (await old_device.get("/api/me")).status_code == 401  # revoked
    async with new_client() as c:
        assert (await login(c)).status_code == 401  # old password no longer works
        assert (await login(c, password="a brand new passphrase")).status_code == 200


async def test_a_reset_link_works_once(new_client, sender) -> None:
    await make_account(new_client, sender)
    async with new_client() as c:
        await c.post("/api/auth/request-reset", json={"email": EMAIL})
        token = sender.token_for(EMAIL)
        body = {"token": token, "password": "a brand new passphrase"}
        assert (await c.post("/api/auth/reset-password", json=body)).status_code == 200
        again = await c.post("/api/auth/reset-password", json=body)
    assert again.status_code == 400 and again.json()["error"]["code"] == "invalid_link"


async def test_a_weak_new_password_does_not_use_up_the_reset_link(new_client, sender) -> None:
    await make_account(new_client, sender)
    async with new_client() as c:
        await c.post("/api/auth/request-reset", json={"email": EMAIL})
        token = sender.token_for(EMAIL)
        weak = await c.post("/api/auth/reset-password", json={"token": token, "password": "short"})
        assert weak.status_code == 422 and weak.json()["error"]["code"] == "weak_password"
        ok = await c.post(
            "/api/auth/reset-password", json={"token": token, "password": "a brand new passphrase"}
        )
    assert ok.status_code == 200


async def test_tokens_only_work_for_their_own_purpose(new_client, sender, sign_in) -> None:
    await make_account(new_client, sender)
    async with new_client() as c:
        await c.post("/api/auth/request-link", json={"email": EMAIL})
        login_token = sender.token_for(EMAIL)
        wrong = await c.post(
            "/api/auth/reset-password",
            json={"token": login_token, "password": "a brand new passphrase"},
        )
        assert wrong.status_code == 400  # a sign-in link cannot reset a password
        await c.post("/api/auth/request-reset", json={"email": EMAIL})
        reset_token = sender.token_for(EMAIL)
        assert (await c.post("/api/auth/verify", json={"token": reset_token})).status_code == 400
        # and the unused reset token still works for its own purpose
        ok = await c.post(
            "/api/auth/reset-password",
            json={"token": reset_token, "password": "a brand new passphrase"},
        )
    assert ok.status_code == 200


async def test_reset_also_lets_a_google_or_link_only_user_add_a_password(
    new_client, sender, sign_in
) -> None:
    async with new_client() as c:
        await sign_in(c, "linkonly@example.com")
        await c.post("/api/auth/request-reset", json={"email": "linkonly@example.com"})
        r = await c.post(
            "/api/auth/reset-password",
            json={"token": sender.token_for("linkonly@example.com"), "password": GOOD},
        )
        assert r.status_code == 200
    async with new_client() as c:
        assert (await login(c, "linkonly@example.com")).status_code == 200


async def test_sessions_table_is_cleared_for_the_user_on_reset(new_client, sender, engine) -> None:
    await make_account(new_client, sender)
    async with new_client() as c:
        await login(c)
        await login(c)
        before = len(await rows(engine, AuthSession))
        await c.post("/api/auth/request-reset", json={"email": EMAIL})
        await c.post(
            "/api/auth/reset-password",
            json={"token": sender.token_for(EMAIL), "password": "a brand new passphrase"},
        )
    assert before >= 3 and len(await rows(engine, AuthSession)) == 1
