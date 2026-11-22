"""The Gmail adapter and the mailbox connection flow, against recorded-style responses. Nothing here
reaches Google: see docs/auto-apply.md for what live verification still needs."""

import base64
import email as emaillib
import json
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app.autoapply.adapters import AdapterError, MailAttachment
from app.autoapply.gmail import STATE_COOKIE, GmailAdapter, GmailOAuth
from app.models import MailboxConnection


@pytest.fixture
def gmail_settings(settings):
    settings.gmail_client_id = "client-id"
    settings.gmail_client_secret = SecretStr("client-secret")
    settings.autoapply_mailbox_provider = "gmail"
    settings.api_public_url = "https://api.example.com"
    settings.web_origin = "https://app.example.com"
    return settings


def mock(handler):
    return httpx.MockTransport(handler)


def id_token(email="ada@example.com", verified=True):
    body = base64.urlsafe_b64encode(
        json.dumps({"email": email, "email_verified": verified}).encode()
    )
    return f"x.{body.decode().rstrip('=')}.y"


# ------------------------------------------------------------------------------ sending


async def test_a_message_is_built_with_our_message_id_and_the_cv_attached(gmail_settings):
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/token":
            return httpx.Response(200, json={"access_token": "at"})
        seen["auth"] = req.headers["authorization"]
        seen["raw"] = json.loads(req.content)["raw"]
        return httpx.Response(200, json={"id": "gm-1", "threadId": "th-1"})

    gmail_settings.google_token_url = "https://oauth.test/token"
    adapter = GmailAdapter(gmail_settings, mock(handler))
    sent = await adapter.send(
        "refresh",
        sender="ada@example.com",
        to="jobs@acme.test",
        subject="PM application",
        body="Hello",
        attachments=[MailAttachment("CV.pdf", b"%PDF-fake")],
        message_id="abc@interviewmeet.app",
    )
    assert seen["auth"] == "Bearer at" and sent.thread_id == "th-1" and sent.provider_id == "gm-1"
    msg = emaillib.message_from_bytes(base64.urlsafe_b64decode(seen["raw"] + "=="))
    assert msg["To"] == "jobs@acme.test" and msg["From"] == "ada@example.com"
    assert msg["Message-ID"] == "<abc@interviewmeet.app>" and msg["Subject"] == "PM application"
    names = [p.get_filename() for p in msg.walk() if p.get_filename()]
    assert names == ["CV.pdf"]


async def test_a_timeout_after_the_request_left_is_an_unknown_outcome(gmail_settings):
    def handler(req):
        if req.url.path == "/token":
            return httpx.Response(200, json={"access_token": "at"})
        raise httpx.ReadTimeout("slow", request=req)

    gmail_settings.google_token_url = "https://oauth.test/token"
    with pytest.raises(AdapterError) as e:
        await GmailAdapter(gmail_settings, mock(handler)).send(
            "r", sender="a@b.c", to="x@y.z", subject="s", body="b", attachments=[], message_id="m"
        )
    assert e.value.code == "ambiguous" and not e.value.transient


async def test_failing_to_connect_at_all_is_safe_to_retry(gmail_settings):
    def handler(req):
        raise httpx.ConnectError("down", request=req)

    gmail_settings.google_token_url = "https://oauth.test/token"
    with pytest.raises(AdapterError) as e:
        await GmailAdapter(gmail_settings, mock(handler)).send(
            "r", sender="a@b.c", to="x@y.z", subject="s", body="b", attachments=[], message_id="m"
        )
    assert e.value.code == "network" and e.value.transient


async def test_revoked_access_means_reconnect(gmail_settings):
    gmail_settings.google_token_url = "https://oauth.test/token"
    adapter = GmailAdapter(
        gmail_settings, mock(lambda r: httpx.Response(400, json={"error": "invalid_grant"}))
    )
    with pytest.raises(AdapterError) as e:
        await adapter.send(
            "r", sender="a@b.c", to="x@y.z", subject="s", body="b", attachments=[], message_id="m"
        )
    assert e.value.code == "reauth"


async def test_a_sent_message_can_be_found_again_by_its_message_id(gmail_settings):
    seen = {}

    def handler(req):
        if req.url.path == "/token":
            return httpx.Response(200, json={"access_token": "at"})
        seen["q"] = parse_qs(urlsplit(str(req.url)).query)["q"][0]
        return httpx.Response(200, json={"messages": [{"id": "gm-9", "threadId": "th-9"}]})

    gmail_settings.google_token_url = "https://oauth.test/token"
    found = await GmailAdapter(gmail_settings, mock(handler)).find_sent(
        "r", "abc@interviewmeet.app"
    )
    assert found.thread_id == "th-9" and seen["q"] == "rfc822msgid:abc@interviewmeet.app in:sent"
    none = GmailAdapter(
        gmail_settings,
        mock(
            lambda r: httpx.Response(
                200, json={"access_token": "at"} if r.url.path == "/token" else {}
            )
        ),
    )
    assert await none.find_sent("r", "nope@x") is None


# --------------------------------------------------------------------------- OAuth flow


def test_the_approval_address_asks_for_the_least_access_and_binds_a_state(gmail_settings):
    url, cookie = GmailOAuth(gmail_settings).begin("user-1")
    q = parse_qs(urlsplit(url).query)
    assert q["client_id"] == ["client-id"] and q["access_type"] == ["offline"]
    scopes = q["scope"][0].split()
    assert "https://www.googleapis.com/auth/gmail.send" in scopes
    assert "https://www.googleapis.com/auth/gmail.readonly" in scopes
    assert not any("mail.google.com" in s or "modify" in s for s in scopes)  # no full access
    assert q["redirect_uri"] == ["https://api.example.com/api/autoapply/mailbox/callback"]
    assert q["state"][0] in cookie


def test_the_state_only_works_for_the_person_who_started_it(gmail_settings):
    oauth = GmailOAuth(gmail_settings)
    url, cookie = oauth.begin("user-1")
    state = parse_qs(urlsplit(url).query)["state"][0]
    assert oauth.check_state(cookie, state, "user-1") is True
    assert oauth.check_state(cookie, state, "user-2") is False  # a different account
    assert oauth.check_state(cookie, "forged", "user-1") is False
    assert oauth.check_state(None, state, "user-1") is False
    assert oauth.check_state(cookie[:-3] + "xxx", state, "user-1") is False  # tampered
    gmail_settings.cookie_secret = SecretStr("another")
    assert GmailOAuth(gmail_settings).check_state(cookie, state, "user-1") is False


async def test_exchange_gives_the_verified_address_and_the_refresh_token(gmail_settings):
    gmail_settings.google_token_url = "https://oauth.test/token"
    ok = httpx.Response(
        200, json={"refresh_token": "rt", "id_token": id_token(), "access_token": "a"}
    )
    assert await GmailOAuth(gmail_settings, mock(lambda r: ok)).exchange("code") == (
        "ada@example.com",
        "rt",
    )
    bad = httpx.Response(
        200, json={"id_token": id_token(), "access_token": "a"}
    )  # no refresh token
    with pytest.raises(AdapterError):
        await GmailOAuth(gmail_settings, mock(lambda r: bad)).exchange("code")
    unverified = httpx.Response(
        200, json={"refresh_token": "rt", "id_token": id_token(verified=False)}
    )
    with pytest.raises(AdapterError):
        await GmailOAuth(gmail_settings, mock(lambda r: unverified)).exchange("code")


async def test_the_connect_and_callback_routes_end_to_end(ada, gmail_settings, maker, monkeypatch):
    async def fake_exchange(self, code):
        assert code == "good-code"
        return "ada@gmail.example", "refresh-secret"

    monkeypatch.setattr(GmailOAuth, "exchange", fake_exchange)
    r = await ada.post("/api/autoapply/mailbox/connect")
    url = r.json()["url"]
    state = parse_qs(urlsplit(url).query)["state"][0]
    assert ada.cookies.get(STATE_COOKIE)
    bad = await ada.get(
        "/api/autoapply/mailbox/callback?code=good-code&state=wrong", follow_redirects=False
    )
    assert bad.status_code == 303 and bad.headers["location"].endswith("?mailbox=failed")
    async with maker() as db:
        assert (await db.execute(select(MailboxConnection))).first() is None  # nothing was stored
    ok = await ada.get(
        f"/api/autoapply/mailbox/callback?code=good-code&state={state}", follow_redirects=False
    )
    assert ok.headers["location"] == "https://app.example.com/auto-apply?mailbox=connected"
    box = (await ada.get("/api/autoapply/mailbox")).json()
    assert (
        box["connected"] is True
        and box["address"] == "ada@gmail.example"
        and box["provider"] == "gmail"
    )
    async with maker() as db:
        conn = (await db.execute(select(MailboxConnection))).scalar_one()
        assert "refresh-secret" not in (conn.token_encrypted or "")


async def test_someone_elses_callback_cannot_attach_a_mailbox_to_this_account(
    ada, gmail_settings, new_client, sign_in, maker, monkeypatch
):
    async def fake_exchange(self, code):
        return "eve@gmail.example", "rt"

    monkeypatch.setattr(GmailOAuth, "exchange", fake_exchange)
    url = (await ada.post("/api/autoapply/mailbox/connect")).json()["url"]
    state = parse_qs(urlsplit(url).query)["state"][0]
    cookie = ada.cookies.get(STATE_COOKIE)
    async with new_client() as eve:
        await sign_in(eve, "eve@example.com")
        eve.cookies.set(STATE_COOKIE, cookie, path="/api/autoapply/mailbox")
        r = await eve.get(
            f"/api/autoapply/mailbox/callback?code=c&state={state}", follow_redirects=False
        )
        assert r.headers["location"].endswith("?mailbox=failed")
    async with maker() as db:
        assert (await db.execute(select(MailboxConnection))).first() is None


async def test_connecting_says_so_when_email_is_not_set_up(ada, settings):
    settings.autoapply_mailbox_provider = "gmail"  # but no client id or secret
    r = await ada.post("/api/autoapply/mailbox/connect")
    assert r.status_code == 503 and r.json()["error"]["code"] == "mailbox_unavailable"
    assert (await ada.get("/api/autoapply/mailbox")).json()["can_connect"] is False
