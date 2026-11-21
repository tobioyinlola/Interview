"""Sending email. Templates (app/services/email_templates.py) build the messages; the senders here
only deliver them. Resend sends for real when configured; local runs print sign-in links to the
console; any other environment without Resend logs an error and sends nothing."""

import logging
from dataclasses import dataclass
from typing import Protocol

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import User
from app.services.events import record_event

log = logging.getLogger("app.email")


@dataclass(frozen=True)
class EmailMessage:
    # signup | login | reset | welcome | password_changed | account_deleted | brief_ready |
    # review_ready | friend_joined | reward_earned | trial_used | credit_granted
    kind: str
    to: str
    subject: str
    html: str
    text: str
    # The one-time sign-in, confirmation or reset link, if the message carries one. Used only to
    # print it in development logs and to let tests pick it up; never logged otherwise.
    link: str | None = None
    reply_to: str | None = None


class EmailSender(Protocol):
    async def send(self, message: EmailMessage) -> bool | None:
        """True when handed to the provider, False when delivery failed, None when unknown."""
        ...


class ConsoleEmailSender:
    """Local development only: prints the link instead of emailing it."""

    async def send(self, message: EmailMessage) -> bool | None:
        if message.link:
            log.info(
                "login link (local only)",
                extra={"fields": {"link": message.link, "kind": message.kind}},
            )
        else:
            log.info("email (local only, not sent)", extra={"fields": {"kind": message.kind}})
        return True


class UnconfiguredEmailSender:
    async def send(self, message: EmailMessage) -> bool | None:
        log.error(
            "no email provider configured; email was not delivered",
            extra={"fields": {"kind": message.kind}},
        )
        return False


def _reason(resp: httpx.Response) -> str:
    """Resend's short error name (for example validation_error). Never its message: that can name
    the recipient."""
    try:
        name = str(resp.json().get("name", ""))
    except (ValueError, AttributeError):
        return "unknown"
    return name if name.replace("_", "").isalnum() and len(name) <= 40 else "unknown"


class ResendEmailSender:
    """Sends through Resend. A failure is logged (never the address, the link or Resend's message)
    and swallowed: the web endpoints answer the same whether or not delivery worked, so they
    must not reveal it."""

    URL = "https://api.resend.com/emails"

    def __init__(
        self,
        api_key: str,
        from_address: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._key = api_key
        self._from = from_address
        self._transport = transport

    async def send(self, message: EmailMessage) -> bool | None:
        body: dict[str, object] = {
            "from": self._from,
            "to": [message.to],
            "subject": message.subject,
            "html": message.html,
            "text": message.text,
        }
        if message.reply_to:
            body["reply_to"] = message.reply_to
        try:
            async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
                resp = await client.post(
                    self.URL, json=body, headers={"authorization": f"Bearer {self._key}"}
                )
            if resp.status_code >= 300:
                log.error(
                    "resend rejected the email",
                    extra={
                        "fields": {
                            "status": resp.status_code,
                            "reason": _reason(resp),
                            "kind": message.kind,
                        }
                    },
                )
                return False
            return True
        except httpx.HTTPError as exc:
            log.error("resend request failed", extra={"fields": {"error": type(exc).__name__}})
            return False


class TeeEmailSender:
    """Development: send for real AND print the link in the log. Lets a dev deployment use a test
    sending address that can only reach one inbox, while sign-ups for other addresses still work."""

    def __init__(self, primary: EmailSender, console: EmailSender) -> None:
        self._senders = (primary, console)

    async def send(self, message: EmailMessage) -> bool | None:
        results = [await sender.send(message) for sender in self._senders]
        return results[0]  # the real provider's outcome; the console copy is only for developers


class AuditedEmailSender:
    """Wraps the real sender and writes each outcome to the admin event log: which kind of email, to
    whom, and whether the provider took it. Never changes what the caller sees."""

    def __init__(self, inner: EmailSender, sf: "async_sessionmaker[AsyncSession]") -> None:
        self._inner = inner
        self._sf = sf

    async def send(self, message: EmailMessage) -> bool | None:
        ok = await self._inner.send(message)
        try:
            async with self._sf() as db:
                uid = (
                    await db.execute(select(User.id).where(User.email == message.to.lower()))
                ).scalar_one_or_none()
            await record_event(
                self._sf,
                "email.failed" if ok is False else "email.sent",
                user_id=uid,
                email_kind=message.kind,
                to=message.to.lower(),
            )
        except Exception as exc:  # the log must never stop a message
            log.warning("email not logged", extra={"fields": {"error": type(exc).__name__}})
        return ok
