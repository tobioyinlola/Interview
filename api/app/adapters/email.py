"""Sign-in link delivery. Resend sends the email when configured; local runs without it log the
link to the console, and any other environment without it logs an error."""

import html
import logging
from typing import Protocol

import httpx

log = logging.getLogger("app.email")


class EmailSender(Protocol):
    async def send_login_link(self, email: str, link: str) -> None: ...


class ConsoleEmailSender:
    """Local development only: prints the link instead of emailing it."""

    async def send_login_link(self, email: str, link: str) -> None:
        log.info("login link (local only)", extra={"fields": {"link": link}})


class UnconfiguredEmailSender:
    async def send_login_link(self, email: str, link: str) -> None:
        log.error("no email provider configured; sign-in link was not delivered")


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
        text = (
            f"Use this link to sign in to InterviewMeet. It works once and expires in "
            f"{self._ttl} minutes.\n\n{link}\n\nIf you did not ask for it, ignore this email."
        )
        safe = html.escape(link, quote=True)
        body = {
            "from": self._from,
            "to": [email],
            "subject": "Your sign-in link",
            "text": text,
            "html": (
                f"<p>Use this link to sign in to InterviewMeet. It works once and "
                f'expires in {self._ttl} minutes.</p><p><a href="{safe}">Sign in</a></p>'
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
                    "resend rejected the email", extra={"fields": {"status": resp.status_code}}
                )
        except httpx.HTTPError as exc:
            log.error("resend request failed", extra={"fields": {"error": type(exc).__name__}})
