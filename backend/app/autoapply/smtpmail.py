"""A mailbox reached over plain SMTP and IMAP with an app password: send from the person's own
address (the provider keeps the copy in their Sent folder) and look for replies. It is the simple
alternative to the Gmail connection: no Google review is needed, but the person has to make an
app password themselves, and it works with Gmail, Outlook and Yahoo.

Only a few well-known providers are allowed, with fixed server names, so a person can never point
the server at an address of their choosing. The password is stored encrypted, like every mailbox
credential, and is never logged or sent back to the browser. Reading is deliberately narrow: the
first read only notes where the inbox is up to, and after that only the headers and the first few
hundred characters of messages that arrived since are looked at, to match replies to notes."""

import asyncio
import base64
import imaplib
import json
import re
import smtplib
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime
from email import message_from_bytes
from email.message import EmailMessage as MimeMessage
from email.utils import parsedate_to_datetime
from typing import Any

from app.autoapply.adapters import (
    AdapterError,
    InboundMessage,
    MailAttachment,
    MailboxAdapter,
    SentMessage,
)

TOKEN_PREFIX = "smtp:"  # noqa: S105 - a label, not a secret
TIMEOUT = 20
MAX_READ = 50


@dataclass(frozen=True)
class Provider:
    label: str
    smtp_host: str
    smtp_port: int
    starttls: bool
    imap_host: str
    sent_folder: str
    gmail: bool = (
        False  # Gmail finds a message by its Message-ID in All Mail, whatever the language
    )
    help: str = ""


PROVIDERS: dict[str, Provider] = {
    "gmail": Provider(
        "Gmail or Google Workspace",
        "smtp.gmail.com",
        465,
        False,
        "imap.gmail.com",
        '"[Gmail]/All Mail"',
        gmail=True,
        help="Google Account, Security, 2-Step Verification, then App passwords.",
    ),
    "outlook": Provider(
        "Outlook or Hotmail",
        "smtp.office365.com",
        587,
        True,
        "outlook.office365.com",
        '"Sent Items"',
        help="Microsoft account, Security, Advanced security options, App passwords.",
    ),
    "yahoo": Provider(
        "Yahoo Mail",
        "smtp.mail.yahoo.com",
        465,
        False,
        "imap.mail.yahoo.com",
        "Sent",
        help="Yahoo Account Security, Generate app password.",
    ),
}


def make_token(provider: str, user: str, password: str) -> str:
    raw = json.dumps({"p": provider, "u": user, "w": password}).encode()
    return TOKEN_PREFIX + base64.urlsafe_b64encode(raw).decode()


def is_smtp_token(token: str) -> bool:
    return token.startswith(TOKEN_PREFIX)


def parse_token(token: str) -> tuple[Provider, str, str]:
    try:
        data = json.loads(base64.urlsafe_b64decode(token[len(TOKEN_PREFIX) :]))
        return PROVIDERS[data["p"]], str(data["u"]), str(data["w"])
    except (ValueError, KeyError, TypeError):
        raise AdapterError("reauth", "The mailbox needs to be connected again.") from None


def _open_smtp(p: Provider) -> smtplib.SMTP:
    ctx = ssl.create_default_context()
    if p.starttls:
        s = smtplib.SMTP(p.smtp_host, p.smtp_port, timeout=TIMEOUT)
        s.starttls(context=ctx)
        return s
    return smtplib.SMTP_SSL(p.smtp_host, p.smtp_port, timeout=TIMEOUT, context=ctx)


def _login_hint(p: Provider) -> str:
    return (
        f"{p.label} did not accept that address and app password. Use an app password, not your "
        f"usual password. To make one: {p.help}"
    )


def _verify_blocking(p: Provider, user: str, password: str) -> None:
    try:
        with _open_smtp(p) as s:
            s.login(user, password)
    except smtplib.SMTPAuthenticationError:
        raise AdapterError("rejected", _login_hint(p)) from None
    except (OSError, smtplib.SMTPException):
        raise AdapterError(
            "network", f"{p.label} could not be reached. Try again in a moment.", transient=True
        ) from None


def _send_blocking(p: Provider, user: str, password: str, msg: MimeMessage) -> None:
    stage = "connect"
    try:
        with _open_smtp(p) as s:
            s.login(user, password)
            stage = "data"  # from here on the provider may have the message
            s.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        raise AdapterError("reauth", "The mailbox needs to be reconnected.") from None
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused):
        raise AdapterError("rejected", "The mailbox refused the message.") from None
    except (smtplib.SMTPDataError, smtplib.SMTPResponseException):
        raise AdapterError("rejected", "The mailbox refused the message.") from None
    except (smtplib.SMTPServerDisconnected, TimeoutError):
        if stage == "data":  # it may have been accepted: the caller must not assume it was not
            raise AdapterError("ambiguous", "The mailbox did not answer in time.") from None
        raise AdapterError("network", "The mailbox could not be reached.", transient=True) from None
    except (OSError, smtplib.SMTPException):
        if stage == "data":
            raise AdapterError("ambiguous", "The connection to the mailbox was lost.") from None
        raise AdapterError("network", "The mailbox could not be reached.", transient=True) from None


def _imap(p: Provider, user: str, password: str) -> imaplib.IMAP4_SSL:
    try:
        box = imaplib.IMAP4_SSL(p.imap_host, 993, ssl_context=ssl.create_default_context())
        box.socket().settimeout(TIMEOUT)
        box.login(user, password)
        return box
    except imaplib.IMAP4.error:
        raise AdapterError("reauth", "The mailbox needs to be reconnected.") from None
    except (OSError, TimeoutError):
        raise AdapterError("network", "The mailbox could not be reached.", transient=True) from None


def _find_sent_blocking(
    p: Provider, user: str, password: str, message_id: str
) -> SentMessage | None:
    box = _imap(p, user, password)
    try:
        if box.select(p.sent_folder, readonly=True)[0] != "OK":
            return None
        if p.gmail:
            typ, data = box.uid("SEARCH", "X-GM-RAW", f'"rfc822msgid:{message_id}"')
        else:
            typ, data = box.uid("SEARCH", "HEADER", "Message-ID", f"<{message_id}>")
        found = data[0].split() if typ == "OK" and data and data[0] else []
        return SentMessage(message_id, None, found[0].decode()) if found else None
    except (imaplib.IMAP4.error, OSError):
        return None
    finally:
        _quiet_logout(box)


def _quiet_logout(box: imaplib.IMAP4_SSL) -> None:
    try:
        box.logout()
    except (imaplib.IMAP4.error, OSError):
        pass


_SPACE = re.compile(r"\s+")


def _snippet(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    return _SPACE.sub(" ", re.sub(r"<[^>]+>", " ", text)).strip()[:300]


def _received(value: str | None) -> datetime:
    try:
        when = parsedate_to_datetime(value or "")
        return when if when.tzinfo else when.replace(tzinfo=UTC)
    except (TypeError, ValueError):
        return datetime.now(UTC)


def _read_blocking(
    p: Provider, user: str, password: str, cursor: str | None
) -> tuple[list[InboundMessage], str]:
    box = _imap(p, user, password)
    try:
        if box.select("INBOX", readonly=True)[0] != "OK":
            return [], cursor or "0"
        if cursor is None:
            # first look: remember where the inbox is up to and read nothing old
            typ, data = box.status("INBOX", "(UIDNEXT)")
            m = re.search(rb"UIDNEXT (\d+)", data[0] if data and data[0] else b"")
            return [], str(int(m.group(1)) - 1) if m else "0"
        last = int(cursor)
        typ, data = box.uid("SEARCH", f"UID {last + 1}:*")
        uids = sorted(int(u) for u in (data[0].split() if typ == "OK" and data[0] else []))
        uids = [u for u in uids if u > last][-MAX_READ:]
        out: list[InboundMessage] = []
        for uid in uids:
            typ, parts = box.uid(
                "FETCH",
                str(uid),
                "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID IN-REPLY-TO REFERENCES DATE)] "
                "BODY.PEEK[TEXT]<0.400>)",
            )
            chunks = [x[1] for x in (parts or []) if isinstance(x, tuple)]
            if typ != "OK" or not chunks:
                continue
            head = message_from_bytes(chunks[0])
            refs = (head.get("References") or "").split()
            out.append(
                InboundMessage(
                    provider_id=str(uid),
                    thread_id=None,
                    message_id=(head.get("Message-ID") or "").strip().strip("<>"),
                    from_addr=head.get("From") or "",
                    subject=head.get("Subject") or "",
                    snippet=_snippet(chunks[1]) if len(chunks) > 1 else "",
                    received_at=_received(head.get("Date")),
                    in_reply_to=((head.get("In-Reply-To") or "").strip().strip("<>")) or None,
                    references=[r.strip("<>") for r in refs],
                )
            )
        return out, str(max(uids)) if uids else str(last)
    except (imaplib.IMAP4.error, OSError):
        raise AdapterError(
            "unavailable", "The mailbox could not be read.", transient=True
        ) from None
    finally:
        _quiet_logout(box)


class SmtpAdapter:
    name = "smtp"
    real = True

    async def verify(self, provider: str, address: str, password: str) -> None:
        """Log in to the provider (nothing is sent). Raises AdapterError with a plain reason."""
        p = PROVIDERS.get(provider)
        if p is None:
            raise AdapterError("rejected", "That email provider is not supported.")
        await asyncio.to_thread(_verify_blocking, p, address, password)

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
        p, user, password = parse_token(token)
        msg = MimeMessage()
        msg["From"], msg["To"], msg["Subject"] = sender, to, subject
        msg["Message-ID"] = f"<{message_id}>"
        msg.set_content(body)
        for a in attachments:
            main, _, sub = a.mime.partition("/")
            msg.add_attachment(a.content, maintype=main, subtype=sub, filename=a.filename)
        await asyncio.to_thread(_send_blocking, p, user, password, msg)
        return SentMessage(message_id, None, None)

    async def find_sent(self, token: str, message_id: str) -> SentMessage | None:
        p, user, password = parse_token(token)
        return await asyncio.to_thread(_find_sent_blocking, p, user, password, message_id)

    async def read_since(self, token: str, cursor: str | None) -> tuple[list[InboundMessage], str]:
        p, user, password = parse_token(token)
        return await asyncio.to_thread(_read_blocking, p, user, password, cursor)

    async def revoke(self, token: str) -> None:
        """An app password cannot be revoked from here; the person can delete it at their provider.
        Forgetting it on our side is what disconnecting does."""
        return None


class RoutedMailbox:
    """Sends through whichever kind of connection a person has: the Gmail connection or an app
    password. The stored credential says which."""

    name = "routed"

    def __init__(
        self, base: MailboxAdapter, *, smtp_on: bool = False, smtp: SmtpAdapter | None = None
    ) -> None:
        self.base, self.smtp, self.smtp_on = base, smtp or SmtpAdapter(), smtp_on

    @property
    def real(self) -> bool:
        return True if self.smtp_on else self.base.real

    def _pick(self, token: str) -> Any:
        return self.smtp if is_smtp_token(token) else self.base

    async def send(self, token: str, **kw: Any) -> SentMessage:
        return await self._pick(token).send(token, **kw)  # type: ignore[no-any-return]

    async def find_sent(self, token: str, message_id: str) -> SentMessage | None:
        return await self._pick(token).find_sent(token, message_id)  # type: ignore[no-any-return]

    async def read_since(self, token: str, cursor: str | None) -> tuple[list[InboundMessage], str]:
        return await self._pick(token).read_since(token, cursor)  # type: ignore[no-any-return]

    async def revoke(self, token: str) -> None:
        await self._pick(token).revoke(token)
