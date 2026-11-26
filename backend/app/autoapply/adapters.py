"""The outside world, behind interfaces. Discovery, employer forms and the mailbox are each a
separate adapter that returns normalised results or raises an explicit error. Every adapter has a
deterministic fixture version, so the whole journey runs with no outside effects."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol


class AdapterError(Exception):
    """An adapter could not do what was asked. `code` is stable; `transient` says whether trying
    again later can help; `message` never contains CV text, credentials or email bodies."""

    def __init__(self, code: str, message: str, *, transient: bool = False) -> None:
        super().__init__(message)
        self.code, self.message, self.transient = code, message, transient


@dataclass
class RawPosting:
    """A job listing as a source reported it, before it is cleaned up."""

    source: str
    source_url: str
    company: str
    title: str
    description: str = ""
    requisition_id: str | None = None
    region: str | None = None
    arrangement: str | None = None
    contract: str | None = None
    seniority: str | None = None
    industry: str | None = None
    salary_min: float | None = None
    salary_max: float | None = None
    salary_currency: str | None = None
    salary_period: str | None = None
    sponsorship: str | None = None
    posted_at: datetime | None = None
    expires_at: datetime | None = None
    application_url: str | None = None
    apply_email: str | None = None
    apply_instructions: str = ""
    hiring_contact: str | None = None
    questions: list[dict[str, Any]] = field(default_factory=list)
    evidence: dict[str, str] = field(default_factory=dict)


class DiscoveryAdapter(Protocol):
    name: str

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        """Roles that might fit. Matching happens afterwards, so an adapter may over-return."""
        ...

    async def fetch(self, url: str) -> RawPosting | None:
        """One listing by its address (a pasted job URL). None when this source cannot read it."""
        ...


@dataclass
class FormField:
    name: str
    label: str
    required: bool = True
    kind: str = "text"  # text | choice | file | declaration | captcha
    options: list[str] = field(default_factory=list)


@dataclass
class FormSchema:
    """What the employer's form asks for, read just now (not from a stored copy)."""

    fields: list[FormField]
    version: str  # changes whenever the form changes: a different version means re-check


@dataclass
class FormReceipt:
    reference: str  # the employer's confirmation or application id
    evidence: str = ""  # the confirmation text or page, short


class FormAdapter(Protocol):
    name: str
    real: bool  # a real form reaches a real employer; the fixture does not

    def supports(self, application_url: str) -> bool:
        """Is this one of the employer forms this adapter is approved to submit?"""
        ...

    async def read_form(self, application_url: str) -> FormSchema: ...

    async def submit(
        self,
        application_url: str,
        *,
        idempotency_key: str,
        values: dict[str, str],
        cv_text: str,
        cv_filename: str,
        cv_layout: dict[str, Any] | None = None,
    ) -> FormReceipt:
        """Submit. Must be safe to call twice with the same idempotency key, or raise
        AdapterError(code='ambiguous') when the outcome is unknown."""
        ...

    async def find_receipt(
        self, application_url: str, *, idempotency_key: str
    ) -> FormReceipt | None:
        """After a timeout: did the employer record this submission? None means it did not."""
        ...


@dataclass
class MailAttachment:
    filename: str
    content: bytes
    mime: str = "application/pdf"


@dataclass
class SentMessage:
    message_id: str  # the Message-ID we set, so a sent message can be found again
    thread_id: str | None = None
    provider_id: str | None = None


@dataclass
class InboundMessage:
    """A message that arrived in the candidate's mailbox. `snippet` is the provider's short
    preview and is read to classify the message; it is never stored."""

    provider_id: str
    thread_id: str | None
    message_id: str
    from_addr: str
    subject: str
    snippet: str
    received_at: datetime
    in_reply_to: str | None = None
    references: list[str] = field(default_factory=list)


class MailboxAdapter(Protocol):
    name: str
    real: bool  # a real mailbox reaches real people; the fixture does not

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
        """Send. A timeout after the request left must raise AdapterError(code='ambiguous')."""
        ...

    async def find_sent(self, token: str, message_id: str) -> SentMessage | None:
        """Is there a sent message with this Message-ID? Used to settle an unknown outcome."""
        ...

    async def read_since(self, token: str, cursor: str | None) -> tuple[list[InboundMessage], str]:
        """New messages since `cursor` and the cursor to use next."""
        ...

    async def revoke(self, token: str) -> None: ...
