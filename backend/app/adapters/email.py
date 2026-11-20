"""Sending email. Templates (app/services/email_templates.py) build the messages; the senders here
only deliver them. Resend sends for real when configured; local runs print sign-in links to the
console; any other environment without Resend logs an error and sends nothing."""

import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

log = logging.getLogger("app.email")


@dataclass(frozen=True)
class EmailMessage:
    kind: str  # signup | login | reset | welcome | password_changed | account_deleted
    to: str
    subject: str
    html: str
    text: str
    # The one-time sign-in, confirmation or reset link, if the message carries one. Used only to
    # print it in development logs and to let tests pick it up; never logged otherwise.
    link: str | None = None
    reply_to: str | None = None


class EmailSender(Protocol):
    async def send(self, message: EmailMessage) -> None: ...


class ConsoleEmailSender:
    """Local development only: prints the link instead of emailing it."""

    async def send(self, message: EmailMessage) -> None:
        if message.link:
            log.info(
                "login link (local only)",
                extra={"fields": {"link": message.link, "kind": message.kind}},
            )
        else:
            log.info("email (local only, not sent)", extra={"fields": {"kind": message.kind}})


class UnconfiguredEmailSender:
    async def send(self, message: EmailMessage) -> None:
        log.error(
            "no email provider configured; email was not delivered",
            extra={"fields": {"kind": message.kind}},
        )


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

    async def send(self, message: EmailMessage) -> None:
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
        except httpx.HTTPError as exc:
            log.error("resend request failed", extra={"fields": {"error": type(exc).__name__}})


class TeeEmailSender:
    """Development: send for real AND print the link in the log. Lets a dev deployment use a test
    sending address that can only reach one inbox, while sign-ups for other addresses still work."""

    def __init__(self, primary: EmailSender, console: EmailSender) -> None:
        self._senders = (primary, console)

    async def send(self, message: EmailMessage) -> None:
        for sender in self._senders:
            await sender.send(message)
