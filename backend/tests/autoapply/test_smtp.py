"""Connecting a mailbox with an app password: sending and reading over SMTP and IMAP (against fakes,
nothing reaches a real server), the connect endpoint, and that the password never leaks."""

import imaplib
import smtplib
from email import message_from_bytes

import pytest
from sqlalchemy import select

from app.autoapply import smtpmail
from app.autoapply.adapters import AdapterError, MailAttachment
from app.autoapply.fixtures import FixtureMailbox
from app.autoapply.smtpmail import RoutedMailbox, SmtpAdapter
from app.models import MailboxConnection

PASSWORD = "abcd efgh ijkl mnop"
TOKEN = smtpmail.make_token("gmail", "ada@gmail.com", "abcdefghijklmnop")


class FakeSMTP:
    sent: list = []
    logins: list = []
    mode = "ok"  # ok | bad_login | refused | drop | unreachable
    hosts: list = []

    def __init__(self, host, port, timeout=None, context=None):
        if FakeSMTP.mode == "unreachable":
            raise OSError("no route")
        FakeSMTP.hosts.append((host, port))

    def starttls(self, context=None):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def login(self, user, password):
        FakeSMTP.logins.append((user, password))
        if FakeSMTP.mode == "bad_login":
            raise smtplib.SMTPAuthenticationError(535, b"nope")

    def send_message(self, msg):
        if FakeSMTP.mode == "refused":
            raise smtplib.SMTPRecipientsRefused({"x@y.z": (550, b"no")})
        if FakeSMTP.mode == "drop":
            raise smtplib.SMTPServerDisconnected("gone")
        FakeSMTP.sent.append(msg)


class FakeIMAP:
    answers: dict = {}
    calls: list = []

    def __init__(self, host, port=993, ssl_context=None):
        FakeIMAP.calls.append(("connect", host))

    def socket(self):
        class S:
            def settimeout(self, t):
                return None

        return S()

    def login(self, user, password):
        return ("OK", [b"ok"])

    def select(self, folder, readonly=False):
        FakeIMAP.calls.append(("select", folder, readonly))
        return ("OK", [b"1"])

    def status(self, folder, what):
        return ("OK", [b"INBOX (UIDNEXT 6)"])

    def uid(self, *args):
        FakeIMAP.calls.append(("uid",) + args)
        key = args[0] if args[0] != "FETCH" else ("FETCH", args[1])
        return FakeIMAP.answers[key]

    def logout(self):
        return ("BYE", [b""])


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    FakeSMTP.sent, FakeSMTP.logins, FakeSMTP.hosts, FakeSMTP.mode = [], [], [], "ok"
    FakeIMAP.answers, FakeIMAP.calls = {}, []
    monkeypatch.setattr(smtpmail.smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setattr(smtpmail.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtpmail.imaplib, "IMAP4_SSL", FakeIMAP)


async def send(**over):
    kw = dict(
        sender="ada@gmail.com", to="jobs@acme.io", subject="PM - Acme", body="Hello",
        attachments=[MailAttachment("Ada - CV.pdf", b"%PDF-1.4 x")], message_id="m-1",
    )  # fmt: skip
    kw.update(over)
    return await SmtpAdapter().send(TOKEN, **kw)


# ------------------------------------------------------------------------------ the token


def test_the_token_round_trips_and_a_damaged_one_asks_to_reconnect():
    p, user, pw = smtpmail.parse_token(TOKEN)
    assert p.smtp_host == "smtp.gmail.com" and user == "ada@gmail.com" and pw == "abcdefghijklmnop"
    assert smtpmail.is_smtp_token(TOKEN) and not smtpmail.is_smtp_token("1//refresh-token")
    with pytest.raises(AdapterError) as e:
        smtpmail.parse_token("smtp:not-base64!!")
    assert e.value.code == "reauth"


# ------------------------------------------------------------------------------ sending


async def test_a_note_goes_out_from_their_address_with_the_cv_and_our_message_id():
    sent = await send()
    assert sent.message_id == "m-1"
    [msg] = FakeSMTP.sent
    assert msg["From"] == "ada@gmail.com" and msg["To"] == "jobs@acme.io"
    assert msg["Message-ID"] == "<m-1>" and msg["Subject"] == "PM - Acme"
    parsed = message_from_bytes(msg.as_bytes())
    assert [p.get_filename() for p in parsed.walk() if p.get_filename()] == ["Ada - CV.pdf"]
    assert FakeSMTP.hosts == [("smtp.gmail.com", 465)]
    assert FakeSMTP.logins == [("ada@gmail.com", "abcdefghijklmnop")]


async def test_outlook_uses_starttls_on_its_own_server():
    token = smtpmail.make_token("outlook", "ada@outlook.com", "secretsecret")
    await SmtpAdapter().send(
        token, sender="ada@outlook.com", to="a@b.co", subject="s", body="b", attachments=[],
        message_id="m-2",
    )  # fmt: skip
    assert FakeSMTP.hosts == [("smtp.office365.com", 587)]


@pytest.mark.parametrize(
    ("mode", "code"),
    [("bad_login", "reauth"), ("refused", "rejected"), ("drop", "ambiguous")],
)
async def test_send_failures_are_told_apart(mode, code):
    FakeSMTP.mode = mode
    with pytest.raises(AdapterError) as e:
        await send()
    assert e.value.code == code
    assert "abcdefghijklmnop" not in str(e.value)


async def test_an_unreachable_server_is_a_retryable_network_error_not_an_unknown_send():
    FakeSMTP.mode = "unreachable"
    with pytest.raises(AdapterError) as e:
        await send()
    assert e.value.code == "network" and e.value.transient


# ------------------------------------------------------------------------------ checking a login


async def test_a_good_app_password_is_checked_without_sending_anything():
    await SmtpAdapter().verify("gmail", "ada@gmail.com", "abcdefghijklmnop")
    assert FakeSMTP.sent == [] and len(FakeSMTP.logins) == 1


async def test_a_wrong_password_says_to_use_an_app_password_and_where_to_make_one():
    FakeSMTP.mode = "bad_login"
    with pytest.raises(AdapterError) as e:
        await SmtpAdapter().verify("gmail", "ada@gmail.com", "nope-nope")
    assert e.value.code == "rejected" and "app password" in e.value.message
    assert "App passwords" in e.value.message


async def test_only_the_listed_providers_are_allowed():
    with pytest.raises(AdapterError):
        await SmtpAdapter().verify("evil.example.com", "a@b.co", "xxxxxxxx")


# ------------------------------------------------------------------------------ finding a sent note


async def test_gmail_finds_a_sent_note_by_message_id_in_all_mail():
    FakeIMAP.answers = {"SEARCH": ("OK", [b"42"])}
    found = await SmtpAdapter().find_sent(TOKEN, "m-1")
    assert found and found.provider_id == "42"
    assert ("select", '"[Gmail]/All Mail"', True) in FakeIMAP.calls  # read-only
    assert ("uid", "SEARCH", "X-GM-RAW", '"rfc822msgid:m-1"') in FakeIMAP.calls


async def test_others_search_the_sent_folder_by_header_and_none_found_is_none():
    token = smtpmail.make_token("yahoo", "ada@yahoo.com", "secretsecret")
    FakeIMAP.answers = {"SEARCH": ("OK", [b""])}
    assert await SmtpAdapter().find_sent(token, "m-9") is None
    assert ("uid", "SEARCH", "HEADER", "Message-ID", "<m-9>") in FakeIMAP.calls


# ------------------------------------------------------------------------------ reading replies


async def test_the_first_read_reads_nothing_old_and_just_notes_where_the_inbox_is():
    msgs, cursor = await SmtpAdapter().read_since(TOKEN, None)
    assert msgs == [] and cursor == "5"
    assert not any(c[0] == "uid" for c in FakeIMAP.calls)  # no message was looked at


async def test_later_reads_return_only_new_mail_with_a_short_snippet():
    head = (
        b"From: Sam <sam@acme.io>\r\nSubject: Re: PM - Acme\r\nMessage-ID: <r-1@acme.io>\r\n"
        b"In-Reply-To: <m-1>\r\nReferences: <m-0> <m-1>\r\nDate: Mon, 02 Nov 2026 09:00:00 +0000\r\n\r\n"
    )
    FakeIMAP.answers = {
        "SEARCH": ("OK", [b"5 6"]),  # 5 is the one already seen: * always returns the last one
        ("FETCH", "6"): ("OK", [(b"6 (UID 6 BODY[HEADER.FIELDS]", head), (b"BODY[TEXT]", b"Thanks, <b>happy</b> to talk.\r\n" + b"x" * 900), b")"]),
    }  # fmt: skip
    msgs, cursor = await SmtpAdapter().read_since(TOKEN, "5")
    assert cursor == "6" and [m.provider_id for m in msgs] == ["6"]
    m = msgs[0]
    assert m.from_addr == "Sam <sam@acme.io>" and m.in_reply_to == "m-1"
    assert m.references == ["m-0", "m-1"] and m.message_id == "r-1@acme.io"
    assert m.snippet.startswith("Thanks, happy to talk.") and len(m.snippet) <= 300
    assert any(c[:2] == ("uid", "FETCH") and "BODY.PEEK" in c[3] for c in FakeIMAP.calls)


# ------------------------------------------------------------------------------ the router


async def test_the_router_sends_each_kind_of_credential_to_its_own_adapter():
    base = FixtureMailbox()
    routed = RoutedMailbox(base, smtp_on=True)
    await routed.send("1//google-refresh-token", sender="a@b.co", to="x@y.co", subject="s",
                      body="b", attachments=[], message_id="m-3")  # fmt: skip
    assert len(base.sent) == 1 and FakeSMTP.sent == []
    await routed.send(TOKEN, sender="a@b.co", to="x@y.co", subject="s", body="b",
                      attachments=[], message_id="m-4")  # fmt: skip
    assert len(base.sent) == 1 and len(FakeSMTP.sent) == 1
    assert routed.real is True and RoutedMailbox(base).real is False


# ------------------------------------------------------------------------------ the endpoint


@pytest.fixture
def smtp_on(settings):
    settings.smtp_mailbox_enabled = True


async def test_off_by_default(ada):
    assert (await ada.get("/api/autoapply/mailbox")).json()["smtp_providers"] == []
    r = await ada.post(
        "/api/autoapply/mailbox/connect-smtp",
        json={"provider": "gmail", "address": "ada@gmail.com", "password": PASSWORD},
    )
    assert r.status_code == 503


async def test_connecting_checks_the_login_stores_it_encrypted_and_never_returns_it(
    ada, maker, smtp_on
):
    listed = (await ada.get("/api/autoapply/mailbox")).json()["smtp_providers"]
    assert {p["id"] for p in listed} == {"gmail", "outlook", "yahoo"}
    r = await ada.post(
        "/api/autoapply/mailbox/connect-smtp",
        json={"provider": "gmail", "address": " Ada@Gmail.com ", "password": PASSWORD},
    )
    assert r.status_code == 200, r.text
    assert r.json()["connected"] and r.json()["address"] == "ada@gmail.com"
    assert "abcdefghijklmnop" not in r.text and "abcd efgh" not in r.text
    assert FakeSMTP.logins[-1] == ("ada@gmail.com", "abcdefghijklmnop")  # spaces removed
    async with maker() as db:
        conn = (await db.execute(select(MailboxConnection))).scalars().one()
    assert conn.provider == "smtp" and conn.status == "connected"
    assert "abcdefghijklmnop" not in (conn.token_encrypted or "")
    got = (await ada.get("/api/autoapply/mailbox")).json()
    assert got["connected"] and got["provider"] == "smtp" and "abcdef" not in str(got)


async def test_a_wrong_password_or_address_is_refused_with_a_reason_and_nothing_is_saved(
    ada, maker, smtp_on
):
    FakeSMTP.mode = "bad_login"
    r = await ada.post(
        "/api/autoapply/mailbox/connect-smtp",
        json={"provider": "gmail", "address": "ada@gmail.com", "password": "wrongwrong"},
    )
    assert r.status_code == 422 and "app password" in r.json()["error"]["message"]
    r = await ada.post(
        "/api/autoapply/mailbox/connect-smtp",
        json={"provider": "gmail", "address": "not-an-address", "password": PASSWORD},
    )
    assert r.status_code == 422
    r = await ada.post(
        "/api/autoapply/mailbox/connect-smtp",
        json={"provider": "somewhere.else", "address": "ada@gmail.com", "password": PASSWORD},
    )
    assert r.status_code == 422
    async with maker() as db:
        assert (await db.execute(select(MailboxConnection))).first() is None


async def test_it_can_be_disconnected_and_the_password_is_forgotten(ada, maker, smtp_on):
    await ada.post(
        "/api/autoapply/mailbox/connect-smtp",
        json={"provider": "gmail", "address": "ada@gmail.com", "password": PASSWORD},
    )
    assert (await ada.post("/api/autoapply/mailbox/disconnect")).status_code == 200
    async with maker() as db:
        conn = (await db.execute(select(MailboxConnection))).scalars().one()
    assert conn.status == "disconnected" and conn.token_encrypted is None


def test_a_real_server_with_app_passwords_on_needs_the_encryption_key():
    from app.config import Settings
    from app.hardening import _autoapply_problems

    s = Settings(environment="production", autoapply_enabled=True, smtp_mailbox_enabled=True)  # type: ignore[call-arg]
    assert any("MAILBOX_ENCRYPTION_KEY" in p for p in _autoapply_problems(s))
    assert imaplib and smtplib  # both are really imported: the fakes patch their classes
