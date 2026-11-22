import json

import httpx
import pytest

from app.adapters.email import (
    AuditedEmailSender,
    ConsoleEmailSender,
    EmailMessage,
    ResendEmailSender,
    UnconfiguredEmailSender,
)
from app.config import Settings
from app.deps import get_email_sender
from app.hardening import validate_settings

LINK = "https://app.example.com/login/verify?token=abc123"


def make(
    kind: str = "login", *, to: str = "a@b.com", link: str | None = LINK, **kw: str
) -> EmailMessage:
    return EmailMessage(
        kind=kind, to=to, subject=kw.get("subject", "Subject"), html=kw.get("html", "<p>Hi</p>"),
        text=kw.get("text", "Hi"), link=link, reply_to=kw.get("reply_to"),
    )  # fmt: skip


def sender(handler):  # type: ignore[no-untyped-def]
    return ResendEmailSender(
        "re_test", "Meet <login@example.com>", transport=httpx.MockTransport(handler)
    )


async def test_sends_one_email_with_html_text_and_the_auth_header() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"id": "x"})

    await sender(handler).send(make(subject="Hello", html="<p>Hello</p>", text="Hello"))
    assert len(seen) == 1
    body = json.loads(seen[0].content)
    assert seen[0].headers["authorization"] == "Bearer re_test"
    assert body["to"] == ["a@b.com"] and body["from"] == "Meet <login@example.com>"
    assert body["subject"] == "Hello" and body["html"] == "<p>Hello</p>" and body["text"] == "Hello"
    assert "reply_to" not in body


async def test_a_reply_to_address_is_passed_on_when_there_is_one() -> None:
    seen: list[dict] = []  # type: ignore[type-arg]

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(json.loads(req.content))
        return httpx.Response(200)

    await sender(handler).send(make(reply_to="help@example.com"))
    assert seen[0]["reply_to"] == "help@example.com"


@pytest.mark.parametrize("status", [401, 422, 500])
async def test_provider_failure_is_swallowed_and_logs_no_address_or_link(
    status: int, caplog: pytest.LogCaptureFixture
) -> None:
    await sender(lambda r: httpx.Response(status)).send(make(to="secret@b.com"))
    logged = " ".join(r.getMessage() + str(getattr(r, "fields", "")) for r in caplog.records)
    assert "secret@b.com" not in logged and "abc123" not in logged


async def test_network_failure_is_swallowed() -> None:
    def boom(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    await sender(boom).send(make())  # does not raise


async def test_the_console_sender_prints_only_links_and_never_message_bodies(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO")  # the console sender logs at info level
    await ConsoleEmailSender().send(make("signup"))
    await ConsoleEmailSender().send(make("welcome", link=None, html="<p>SECRET BODY</p>"))
    logged = " ".join(r.getMessage() + str(getattr(r, "fields", "")) for r in caplog.records)
    assert LINK in logged and "SECRET BODY" not in logged


async def test_the_unconfigured_sender_sends_nothing_and_says_so(
    caplog: pytest.LogCaptureFixture,
) -> None:
    await UnconfiguredEmailSender().send(make())
    assert any("not delivered" in r.getMessage() for r in caplog.records)


def test_resend_is_chosen_when_configured_and_otherwise_never_for_unconfigured_prod() -> None:
    on = Settings(environment="production", resend_api_key="re_x", email_from="a@b.com")
    # every sender is wrapped so its outcome reaches the admin event log
    assert isinstance(get_email_sender(on), AuditedEmailSender)
    assert isinstance(get_email_sender(on)._inner, ResendEmailSender)  # type: ignore[attr-defined]
    off = Settings(environment="production")
    assert type(get_email_sender(off)._inner).__name__ == "UnconfiguredEmailSender"  # type: ignore[attr-defined]
    local = get_email_sender(Settings(environment="local"))
    assert type(local._inner).__name__ == "ConsoleEmailSender"  # type: ignore[attr-defined]


def test_production_refuses_to_boot_without_email_configuration() -> None:
    base = dict(
        environment="production",
        cookie_secret="x" * 40,
        web_origin="https://app.example.com",
        database_url="postgresql+asyncpg://u:p@db/x",
        openai_api_key="sk-x",
    )
    assert any("RESEND_API_KEY" in p for p in validate_settings(Settings(**base)))
    ok = Settings(**base, resend_api_key="re_x", email_from="a@b.com")
    assert validate_settings(ok) == []


def test_a_plain_postgres_address_gets_the_async_driver() -> None:
    for given in ("postgresql://u:p@db:5432/x", "postgres://u:p@db:5432/x"):
        assert Settings(database_url=given).database_url == "postgresql+asyncpg://u:p@db:5432/x"  # type: ignore[arg-type]
    already = "postgresql+asyncpg://u:p@db:5432/x"
    assert Settings(database_url=already).database_url == already  # type: ignore[arg-type]


def test_dev_email_links_work_in_staging_only_and_never_in_production() -> None:
    staging = Settings(environment="staging", dev_log_email_links=True)  # type: ignore[arg-type]
    assert type(get_email_sender(staging)._inner).__name__  # type: ignore[attr-defined] == "ConsoleEmailSender"
    prod = Settings(environment="production", dev_log_email_links=True)  # type: ignore[arg-type]
    assert type(get_email_sender(prod)._inner).__name__  # type: ignore[attr-defined] == "UnconfiguredEmailSender"
    off = Settings(environment="staging")  # type: ignore[arg-type]
    assert type(get_email_sender(off)._inner).__name__  # type: ignore[attr-defined] == "UnconfiguredEmailSender"
    base = dict(
        cookie_secret="x" * 40,
        web_origin="https://app.example.com",
        database_url="postgresql+asyncpg://u:p@db/x",
        openai_api_key="sk-x",
    )
    ok = Settings(environment="staging", dev_log_email_links=True, **base)  # type: ignore[arg-type]
    assert validate_settings(ok) == []  # no email provider needed for a dev deployment
    bad = Settings(environment="production", dev_log_email_links=True, **base)  # type: ignore[arg-type]
    assert any("DEV_LOG_EMAIL_LINKS" in p for p in validate_settings(bad))
    no_flag = Settings(environment="staging", **base)  # type: ignore[arg-type]
    assert any("RESEND_API_KEY" in p for p in validate_settings(no_flag))


async def test_dev_mode_with_resend_sends_for_real_and_also_logs_the_link() -> None:
    from app.adapters.email import TeeEmailSender

    cfg = Settings(  # type: ignore[arg-type]
        environment="staging",
        dev_log_email_links=True,
        resend_api_key="re_x",
        email_from="Meet <onboarding@resend.dev>",
    )
    sender = get_email_sender(cfg)
    assert isinstance(sender._inner, TeeEmailSender)  # type: ignore[attr-defined]
    # production-style config (no dev switch) sends only through Resend
    plain = Settings(environment="staging", resend_api_key="re_x", email_from="a@b.com")  # type: ignore[arg-type]
    assert isinstance(get_email_sender(plain)._inner, ResendEmailSender)  # type: ignore[attr-defined]


async def test_tee_sender_calls_the_real_sender_and_the_log_in_order() -> None:
    from app.adapters.email import TeeEmailSender

    calls: list[str] = []

    class Rec:
        def __init__(self, name: str) -> None:
            self.name = name

        async def send(self, message: EmailMessage) -> None:
            calls.append(f"{self.name}:{message.kind}")

    tee = TeeEmailSender(Rec("resend"), Rec("log"))  # type: ignore[arg-type]
    await tee.send(make("signup"))
    await tee.send(make("reset"))
    assert calls == ["resend:signup", "log:signup", "resend:reset", "log:reset"]


async def test_the_log_names_the_resend_error_but_never_its_message(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "name": "validation_error",
                "message": "You can only send testing emails to owner@private.example",
            },
        )

    await sender(refuse).send(make("login", to="someone@b.com"))
    logged = " ".join(r.getMessage() + str(getattr(r, "fields", "")) for r in caplog.records)
    assert "validation_error" in logged and "403" in logged
    assert "owner@private.example" not in logged and "someone@b.com" not in logged
