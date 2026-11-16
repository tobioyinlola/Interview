"""Sign-in link delivery. The real provider is an open decision; until one is configured,
local runs log the link to the console and other environments log an error."""

import logging
from typing import Protocol

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
