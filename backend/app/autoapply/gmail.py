"""Gmail, through Google's OAuth and REST API. Not exercised against the live service in this
repository: it is tested with recorded responses only, and needs a Google Cloud project with the
Gmail API enabled and the sensitive scopes approved before real use (see docs/auto-apply.md)."""

import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import UTC, datetime
from email.message import EmailMessage as MimeMessage
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlencode

import httpx

from app.autoapply.adapters import AdapterError, InboundMessage, MailAttachment, SentMessage
from app.config import Settings

API = "https://gmail.googleapis.com/gmail/v1/users/me"
SCOPES = (
    "https://www.googleapis.com/auth/gmail.send "
    "https://www.googleapis.com/auth/gmail.readonly "
    "openid email"
)
STATE_COOKIE = "aa_mailbox_state"
STATE_TTL = 600


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class GmailOAuth:
    """Connecting a mailbox. The `state` is bound to the person who started it by a signed,
    short-lived cookie that also names their user id, so a callback cannot attach someone else's
    mailbox to this account."""

    def __init__(self, s: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.s, self._transport = s, transport

    @property
    def enabled(self) -> bool:
        return bool(self.s.gmail_client_id and self.s.gmail_client_secret.get_secret_value())

    @property
    def redirect_uri(self) -> str:
        return f"{self.s.api_public_url.rstrip('/')}/api/autoapply/mailbox/callback"

    def _sign(self, payload: str) -> str:
        key = self.s.cookie_secret.get_secret_value().encode()
        return _b64(hmac.new(key, payload.encode(), hashlib.sha256).digest())

    def begin(self, user_id: str) -> tuple[str, str]:
        """(address to send the browser to, value for the state cookie)."""
        state = secrets.token_urlsafe(32)
        expires = int(time.time()) + STATE_TTL
        body = f"{state}.{user_id}.{expires}"
        query = urlencode(
            {
                "client_id": self.s.gmail_client_id,
                "redirect_uri": self.redirect_uri,
                "response_type": "code",
                "scope": SCOPES,
                "state": state,
                "access_type": "offline",
                "prompt": "consent",
            }
        )
        return f"{self.s.google_auth_url}?{query}", f"{body}.{self._sign(body)}"

    def check_state(self, cookie: str | None, state: str, user_id: str) -> bool:
        if not cookie:
            return False
        try:
            st, uid, exp, sig = cookie.rsplit(".", 3)
        except ValueError:
            return False
        body = f"{st}.{uid}.{exp}"
        return (
            hmac.compare_digest(sig, self._sign(body))
            and hmac.compare_digest(st, state)
            and uid == user_id
            and int(exp) >= int(time.time())
        )

    async def exchange(self, code: str) -> tuple[str, str]:
        """(email address, credential to store). The credential is the refresh token."""
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=15) as c:
                r = await c.post(
                    self.s.google_token_url,
                    data={
                        "code": code,
                        "client_id": self.s.gmail_client_id,
                        "client_secret": self.s.gmail_client_secret.get_secret_value(),
                        "redirect_uri": self.redirect_uri,
                        "grant_type": "authorization_code",
                    },
                )
        except httpx.HTTPError:
            raise AdapterError("network", "Google could not be reached.", transient=True) from None
        if r.status_code != 200:
            raise AdapterError("rejected", "Google did not accept the connection.")
        data = r.json()
        refresh = data.get("refresh_token")
        if not refresh:
            raise AdapterError("rejected", "Google did not give lasting access. Try again.")
        try:
            claims = json.loads(base64.urlsafe_b64decode(data["id_token"].split(".")[1] + "=="))
        except (KeyError, ValueError, IndexError):
            raise AdapterError("rejected", "Google did not say which mailbox this is.") from None
        if not claims.get("email") or not claims.get("email_verified", False):
            raise AdapterError("rejected", "That Google address is not verified.")
        return str(claims["email"]).lower(), refresh


class GmailAdapter:
    name = "gmail"
    real = True

    def __init__(self, s: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.s, self._transport = s, transport

    async def _call(self, method: str, url: str, token: str | None = None, **kw: Any) -> Any:
        headers = kw.pop("headers", {})
        if token:
            headers["authorization"] = f"Bearer {token}"
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=20) as c:
                r = await c.request(method, url, headers=headers, **kw)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            raise AdapterError("network", "Gmail could not be reached.", transient=True) from None
        except httpx.TimeoutException:
            # the request may have been accepted: the caller must not assume it was not
            raise AdapterError("ambiguous", "Gmail did not answer in time.") from None
        except httpx.HTTPError:
            raise AdapterError("ambiguous", "The connection to Gmail was lost.") from None
        if r.status_code in (401, 403):
            raise AdapterError("reauth", "The mailbox needs to be reconnected.")
        if r.status_code == 404:
            return None
        if r.status_code == 429 or r.status_code >= 500:
            raise AdapterError("unavailable", "Gmail is busy.", transient=r.status_code == 429)
        if r.status_code >= 400:
            raise AdapterError("rejected", f"Gmail answered {r.status_code}.")
        return r.json() if r.content else {}

    async def _access(self, refresh: str) -> str:
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=15) as c:
                r = await c.post(
                    self.s.google_token_url,
                    data={
                        "client_id": self.s.gmail_client_id,
                        "client_secret": self.s.gmail_client_secret.get_secret_value(),
                        "refresh_token": refresh,
                        "grant_type": "refresh_token",
                    },
                )
        except httpx.HTTPError:
            raise AdapterError("network", "Google could not be reached.", transient=True) from None
        if r.status_code in (400, 401):
            raise AdapterError("reauth", "The mailbox needs to be reconnected.")
        if r.status_code != 200:
            raise AdapterError("unavailable", "Google is busy.", transient=True)
        return str(r.json()["access_token"])

    async def send(
        self,
        token: str,
        *,
        sender: str,
        to: str,
        subject: str,
        body: str,
        attachments: list[MailAttachment],
        message_id: str,
    ) -> SentMessage:
        access = await self._access(token)
        msg = MimeMessage()
        msg["From"], msg["To"], msg["Subject"] = sender, to, subject
        msg["Message-ID"] = f"<{message_id}>"
        msg.set_content(body)
        for a in attachments:
            main, _, sub = a.mime.partition("/")
            msg.add_attachment(a.content, maintype=main, subtype=sub, filename=a.filename)
        raw = _b64(msg.as_bytes())
        data = await self._call("POST", f"{API}/messages/send", access, json={"raw": raw})
        return SentMessage(message_id, data.get("threadId"), data.get("id"))

    async def find_sent(self, token: str, message_id: str) -> SentMessage | None:
        access = await self._access(token)
        q = urlencode({"q": f"rfc822msgid:{message_id} in:sent", "maxResults": 1})
        data = await self._call("GET", f"{API}/messages?{q}", access)
        found = (data or {}).get("messages") or []
        return SentMessage(message_id, found[0].get("threadId"), found[0]["id"]) if found else None

    async def _inbound(self, access: str, provider_id: str) -> InboundMessage | None:
        q = urlencode(
            [("format", "metadata")]
            + [
                ("metadataHeaders", h)
                for h in ("From", "Subject", "Date", "Message-ID", "In-Reply-To", "References")
            ]
        )
        m = await self._call("GET", f"{API}/messages/{provider_id}?{q}", access)
        if not m or "SENT" in m.get("labelIds", []) or "DRAFT" in m.get("labelIds", []):
            return None
        h = {x["name"].lower(): x["value"] for x in m.get("payload", {}).get("headers", [])}
        try:
            received = parsedate_to_datetime(h["date"]).astimezone(UTC)
        except (KeyError, TypeError, ValueError):
            received = datetime.fromtimestamp(int(m.get("internalDate", "0")) / 1000, UTC)
        return InboundMessage(
            provider_id=provider_id,
            thread_id=m.get("threadId"),
            message_id=h.get("message-id", "").strip("<>"),
            from_addr=h.get("from", ""),
            subject=h.get("subject", ""),
            snippet=m.get("snippet", ""),
            received_at=received,
            in_reply_to=h.get("in-reply-to", "").strip("<>") or None,
            references=[r.strip("<>") for r in h.get("references", "").split() if r],
        )

    async def read_since(self, token: str, cursor: str | None) -> tuple[list[InboundMessage], str]:
        access = await self._access(token)
        ids: list[str] = []
        profile = await self._call("GET", f"{API}/profile", access)
        newest = str((profile or {}).get("historyId", cursor or "0"))
        if cursor:
            page = await self._call(
                "GET",
                f"{API}/history?startHistoryId={cursor}&historyTypes=messageAdded&maxResults=100",
                access,
            )
            if page is not None:  # None: the cursor is too old, so read recent mail instead
                for h in page.get("history", []):
                    ids += [m["message"]["id"] for m in h.get("messagesAdded", [])]
                cursor_ok = True
            else:
                cursor_ok = False
        else:
            cursor_ok = False
        if not cursor_ok:
            q = urlencode({"q": "newer_than:14d in:inbox", "maxResults": 50})
            data = await self._call("GET", f"{API}/messages?{q}", access)
            ids = [m["id"] for m in (data or {}).get("messages", [])]
        out: list[InboundMessage] = []
        for pid in dict.fromkeys(ids):
            msg = await self._inbound(access, pid)
            if msg is not None:
                out.append(msg)
        return out, newest

    async def revoke(self, token: str) -> None:
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=10) as c:
                await c.post("https://oauth2.googleapis.com/revoke", data={"token": token})
        except httpx.HTTPError:
            pass  # revoking is best effort: the stored token is deleted either way
