import json

import httpx
import pytest

from app.adapters.email import ResendEmailSender
from app.config import Settings
from app.deps import get_email_sender
from app.hardening import validate_settings

LINK = "https://app.example.com/login/verify?token=abc123"


def sender(handler):  # type: ignore[no-untyped-def]
    return ResendEmailSender(
        "re_test", "Meet <login@example.com>", transport=httpx.MockTransport(handler)
    )


async def test_sends_one_email_with_the_link_and_auth_header() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"id": "x"})

    await sender(handler).send_login_link("a@b.com", LINK)
    assert len(seen) == 1
    body = json.loads(seen[0].content)
    assert seen[0].headers["authorization"] == "Bearer re_test"
    assert body["to"] == ["a@b.com"] and body["from"] == "Meet <login@example.com>"
    assert LINK in body["text"] and LINK in body["html"]


async def test_link_is_escaped_in_the_html_body() -> None:
    seen: list[dict] = []  # type: ignore[type-arg]

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(json.loads(req.content))
        return httpx.Response(200)

    await sender(handler).send_login_link("a@b.com", 'https://x.test/?a="><script>')
    assert "<script>" not in seen[0]["html"]


@pytest.mark.parametrize("status", [401, 422, 500])
async def test_provider_failure_is_swallowed_and_logs_no_address_or_link(
    status: int, caplog: pytest.LogCaptureFixture
) -> None:
    await sender(lambda r: httpx.Response(status)).send_login_link("secret@b.com", LINK)
    logged = " ".join(r.getMessage() + str(getattr(r, "fields", "")) for r in caplog.records)
    assert "secret@b.com" not in logged and "abc123" not in logged


async def test_network_failure_is_swallowed() -> None:
    def boom(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    await sender(boom).send_login_link("a@b.com", LINK)  # does not raise


def test_resend_is_chosen_when_configured_and_otherwise_never_for_unconfigured_prod() -> None:
    on = Settings(environment="production", resend_api_key="re_x", email_from="a@b.com")
    assert isinstance(get_email_sender(on), ResendEmailSender)
    off = Settings(environment="production")
    assert type(get_email_sender(off)).__name__ == "UnconfiguredEmailSender"
    assert type(get_email_sender(Settings(environment="local"))).__name__ == "ConsoleEmailSender"


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
    assert type(get_email_sender(staging)).__name__ == "ConsoleEmailSender"
    prod = Settings(environment="production", dev_log_email_links=True)  # type: ignore[arg-type]
    assert type(get_email_sender(prod)).__name__ == "UnconfiguredEmailSender"
    off = Settings(environment="staging")  # type: ignore[arg-type]
    assert type(get_email_sender(off)).__name__ == "UnconfiguredEmailSender"
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
    assert isinstance(sender, TeeEmailSender)
    # production-style config (no dev switch) sends only through Resend
    plain = Settings(environment="staging", resend_api_key="re_x", email_from="a@b.com")  # type: ignore[arg-type]
    assert isinstance(get_email_sender(plain), ResendEmailSender)


async def test_tee_sender_calls_the_real_sender_and_the_log_in_order() -> None:
    from app.adapters.email import TeeEmailSender

    calls: list[str] = []

    class Rec:
        def __init__(self, name: str) -> None:
            self.name = name

        async def send_login_link(self, email: str, link: str) -> None:
            calls.append(f"{self.name}:login")

        async def send_signup_link(self, email: str, link: str) -> None:
            calls.append(f"{self.name}:signup")

        async def send_reset_link(self, email: str, link: str) -> None:
            calls.append(f"{self.name}:reset")

    tee = TeeEmailSender(Rec("resend"), Rec("log"))  # type: ignore[arg-type]
    await tee.send_signup_link("a@b.com", "https://x/y")
    await tee.send_reset_link("a@b.com", "https://x/y")
    assert calls == ["resend:signup", "log:signup", "resend:reset", "log:reset"]
