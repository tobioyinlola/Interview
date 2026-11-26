"""Deterministic stand-ins for every outside system. They make the whole journey runnable in
development, staging and tests with no outside effects: nothing here touches a network."""

from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from app.autoapply.adapters import (
    AdapterError,
    FormField,
    FormReceipt,
    FormSchema,
    RawPosting,
)

FIXTURE_HOST = "jobs.fixture.test"


class FixtureDiscovery:
    """Returns the postings it was given. `fetch` finds one by its address."""

    name = "fixture"

    def __init__(self, postings: list[RawPosting] | None = None) -> None:
        self.postings: list[RawPosting] = list(postings or [])
        self.searches = 0
        self.fail_with: AdapterError | None = None

    async def search(self, criteria: dict[str, Any], now: datetime) -> list[RawPosting]:
        self.searches += 1
        if self.fail_with:
            raise self.fail_with
        return list(self.postings)

    async def fetch(self, url: str) -> RawPosting | None:
        for p in self.postings:
            if url in (p.source_url, p.application_url):
                return p
        return None


class FixtureForm:
    """An employer form that lives in memory. A test can make it ask different questions, fail,
    or time out *after* recording the submission, which is the dangerous case."""

    name = "fixture"
    real = False

    def __init__(self) -> None:
        self.schemas: dict[str, FormSchema] = {}
        self.submitted: dict[str, dict[str, Any]] = {}  # idempotency key -> what was sent
        self.receipts: dict[str, FormReceipt] = {}
        self.calls = 0
        self.mode = "ok"  # ok | fail | timeout_after | timeout_before | captcha

    def supports(self, application_url: str) -> bool:
        return urlsplit(application_url).hostname == FIXTURE_HOST

    async def read_form(self, application_url: str) -> FormSchema:
        if self.mode == "captcha":
            return FormSchema([FormField("captcha", "Prove you are human", kind="captcha")], "c1")
        return self.schemas.get(
            application_url,
            FormSchema(
                [
                    FormField("name", "Full name"),
                    FormField("email", "Email"),
                    FormField("resume", "CV", kind="file"),
                ],
                "v1",
            ),
        )

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
        self.calls += 1
        if self.mode == "fail":
            raise AdapterError("rejected", "The form refused the application.")
        if self.mode == "timeout_before":
            raise AdapterError("ambiguous", "The employer did not answer in time.")
        if idempotency_key in self.receipts:
            return self.receipts[idempotency_key]  # a repeat of the same intent changes nothing
        receipt = FormReceipt(reference=f"FX-{len(self.receipts) + 1:04d}", evidence="Thank you.")
        self.submitted[idempotency_key] = {
            "url": application_url,
            "values": values,
            "cv": cv_text,
            "filename": cv_filename,
        }
        self.receipts[idempotency_key] = receipt
        if self.mode == "timeout_after":
            raise AdapterError("ambiguous", "The employer did not answer in time.")
        return receipt

    async def find_receipt(
        self, application_url: str, *, idempotency_key: str
    ) -> FormReceipt | None:
        return self.receipts.get(idempotency_key)


class FixtureMailbox:
    """A mailbox in memory. Tests drop messages into `inbox`, and can make a send fail or time
    out after the message was already accepted."""

    name = "fixture"
    real = False

    def __init__(self) -> None:
        from app.autoapply.adapters import InboundMessage, SentMessage

        self.sent: list[dict[str, Any]] = []
        self.inbox: list[InboundMessage] = []
        self.mode = "ok"  # ok | fail | timeout_after | timeout_before | reauth
        self.revoked = 0
        self.calls = 0
        self._sent_cls = SentMessage

    async def send(self, token: str, *, sender, to, subject, body, attachments, message_id):  # type: ignore[no-untyped-def]
        self.calls += 1
        if self.mode == "reauth":
            raise AdapterError("reauth", "The mailbox needs to be reconnected.")
        if self.mode == "fail":
            raise AdapterError("rejected", "The mailbox refused the message.")
        if self.mode == "timeout_before":
            raise AdapterError("ambiguous", "The mailbox did not answer in time.")
        if any(m["message_id"] == message_id for m in self.sent):
            return self._sent_cls(message_id, "thread-" + message_id, "p-" + message_id)
        self.sent.append(
            {
                "from": sender,
                "to": to,
                "subject": subject,
                "body": body,
                "attachments": attachments,
                "message_id": message_id,
            }
        )
        if self.mode == "timeout_after":
            raise AdapterError("ambiguous", "The mailbox did not answer in time.")
        return self._sent_cls(message_id, "thread-" + message_id, "p-" + message_id)

    async def find_sent(self, token: str, message_id: str):  # type: ignore[no-untyped-def]
        for m in self.sent:
            if m["message_id"] == message_id:
                return self._sent_cls(message_id, "thread-" + message_id, "p-" + message_id)
        return None

    async def read_since(self, token: str, cursor: str | None):  # type: ignore[no-untyped-def]
        if self.mode == "reauth":
            raise AdapterError("reauth", "The mailbox needs to be reconnected.")
        start = int(cursor or 0)
        return self.inbox[start:], str(len(self.inbox))

    async def revoke(self, token: str) -> None:
        self.revoked += 1
