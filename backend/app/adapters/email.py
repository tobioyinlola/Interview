"""Sign-in link delivery. Resend sends the email when configured; local runs without it log the
link to the console, and any other environment without it logs an error."""

import html
import logging
from typing import Protocol

import httpx

log = logging.getLogger("app.email")


class EmailSender(Protocol):
    async def send_login_link(self, email: str, link: str) -> None: ...

    async def send_signup_link(self, email: str, link: str) -> None: ...

    async def send_reset_link(self, email: str, link: str) -> None: ...


class ConsoleEmailSender:
    """Local development only: prints the link instead of emailing it."""

    async def send_login_link(self, email: str, link: str) -> None:
        log.info("login link (local only)", extra={"fields": {"link": link}})

    async def send_signup_link(self, email: str, link: str) -> None:
        log.info("login link (local only)", extra={"fields": {"link": link, "kind": "signup"}})

    async def send_reset_link(self, email: str, link: str) -> None:
        log.info("login link (local only)", extra={"fields": {"link": link, "kind": "reset"}})


class UnconfiguredEmailSender:
    async def send_login_link(self, email: str, link: str) -> None:
        log.error("no email provider configured; sign-in link was not delivered")

    async def send_signup_link(self, email: str, link: str) -> None:
        log.error("no email provider configured; sign-up link was not delivered")

    async def send_reset_link(self, email: str, link: str) -> None:
        log.error("no email provider configured; reset link was not delivered")


def _reason(resp: httpx.Response) -> str:
    """Resend's short error name (for example validation_error). Never its message: that can name
    the recipient."""
    try:
        name = str(resp.json().get("name", ""))
    except (ValueError, AttributeError):
        return "unknown"
    return name if name.replace("_", "").isalnum() and len(name) <= 40 else "unknown"


class ResendEmailSender:
    """Sends the sign-in email through Resend. A failure is logged (never the address or link) and
    swallowed: the sign-in endpoint answers the same for every address, so it must not reveal
    whether delivery worked."""

    URL = "https://api.resend.com/emails"

    def __init__(
        self,
        api_key: str,
        from_address: str,
        *,
        ttl_minutes: int = 15,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._key = api_key
        self._from = from_address
        self._ttl = ttl_minutes
        self._transport = transport

    async def send_login_link(self, email: str, link: str) -> None:
        await self._send(
            email,
            link,
            subject="Your sign-in link",
            lead="Use this link to sign in to InterviewMeet.",
            button="Sign in",
        )

    async def send_signup_link(self, email: str, link: str) -> None:
        await self._send(
            email,
            link,
            subject="Confirm your email to finish creating your account",
            lead="Confirm your email address to finish creating your InterviewMeet account.",
            button="Confirm and sign in",
        )

    async def send_reset_link(self, email: str, link: str) -> None:
        await self._send(
            email,
            link,
            subject="Reset your password",
            lead="Use this link to choose a new password for InterviewMeet.",
            button="Choose a new password",
        )

    async def _send(self, email: str, link: str, *, subject: str, lead: str, button: str) -> None:
        text = (
            f"{lead} It works once and expires in {self._ttl} minutes.\n\n{link}\n\n"
            "If you did not ask for it, ignore this email."
        )
        safe = html.escape(link, quote=True)
        body = {
            "from": self._from,
            "to": [email],
            "subject": subject,
            "text": text,
            "html": (
                f"<p>{lead} It works once and expires in {self._ttl} minutes.</p>"
                f'<p><a href="{safe}">{button}</a></p>'
                f"<p>If you did not ask for it, ignore this email.</p>"
            ),
        }
        try:
            async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
                resp = await client.post(
                    self.URL, json=body, headers={"authorization": f"Bearer {self._key}"}
                )
            if resp.status_code >= 300:
                log.error(
                    "resend rejected the email",
                    extra={"fields": {"status": resp.status_code, "reason": _reason(resp)}},
                )
        except httpx.HTTPError as exc:
            log.error("resend request failed", extra={"fields": {"error": type(exc).__name__}})


class TeeEmailSender:
    """Development: send for real AND print the link in the log. Lets a dev deployment use a test
    sending address that can only reach one inbox, while sign-ups for other addresses still work."""

    def __init__(self, primary: EmailSender, console: EmailSender) -> None:
        self._senders = (primary, console)

    async def send_login_link(self, email: str, link: str) -> None:
        for sender in self._senders:
            await sender.send_login_link(email, link)

    async def send_signup_link(self, email: str, link: str) -> None:
        for sender in self._senders:
            await sender.send_signup_link(email, link)

    async def send_reset_link(self, email: str, link: str) -> None:
        for sender in self._senders:
            await sender.send_reset_link(email, link)
