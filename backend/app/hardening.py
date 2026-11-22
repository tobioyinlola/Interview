"""Startup checks and request-level protections: unsafe configuration is refused at boot in staging
and production, every response carries security headers, oversized bodies are rejected, and a
per-client rate limit blunts scripted abuse."""

import json
import time
from collections import defaultdict, deque
from collections.abc import Callable, MutableMapping
from typing import Any
from urllib.parse import urlparse

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import Settings
from app.logging_config import request_id_var
from app.services.clientip import forwarded_client_ip

DEFAULT_API_URL = "http://localhost:8000"
KNOWN_ENVIRONMENTS = {"local", "staging", "production"}
DEFAULT_COOKIE_SECRET = "dev-only-change-me"  # noqa: S105 - the value we refuse to run with


# Hosts where every subdomain belongs to a different customer, so browsers treat two of them as
# different sites and refuse to send the login cookie between them.
SHARED_SUFFIXES = (
    "up.railway.app", "railway.app", "vercel.app", "netlify.app", "herokuapp.com", "onrender.com",
    "fly.dev", "github.io", "pages.dev", "workers.dev", "azurewebsites.net", "appspot.com",
)  # fmt: skip


def same_site(a: str, b: str) -> bool:
    """Whether two origins are one site for cookies (sibling subdomains of a private domain)."""
    ha, hb = (urlparse(x).hostname or "" for x in (a, b))
    if ha == hb:
        return True
    if any(h == suf or h.endswith("." + suf) for h in (ha, hb) for suf in SHARED_SUFFIXES):
        return False

    def parent(host: str) -> str:
        return host.split(".", 1)[1] if "." in host else host

    return parent(ha) == parent(hb) or parent(ha) == hb or parent(hb) == ha


def validate_settings(s: Settings) -> list[str]:
    """Problems that make a deployment unsafe. Empty means fine. Local runs are never blocked."""
    if s.environment not in KNOWN_ENVIRONMENTS:
        return [f"ENVIRONMENT must be one of {sorted(KNOWN_ENVIRONMENTS)}, not {s.environment!r}."]
    if s.environment == "local":
        return []
    problems: list[str] = []
    secret = s.cookie_secret.get_secret_value()
    if secret == DEFAULT_COOKIE_SECRET or len(secret) < 32:
        problems.append("COOKIE_SECRET must be set to a random value of at least 32 characters.")
    if not s.web_origin.startswith("https://"):
        problems.append(
            "WEB_ORIGIN must be an https:// origin (tab capture needs a secure context)."
        )
    if "postgres:postgres@" in s.database_url:
        problems.append("DATABASE_URL uses the default postgres:postgres credentials.")
    if s.use_fake_providers:
        problems.append("USE_FAKE_PROVIDERS must be off.")
    if bool(s.google_client_id) != bool(s.google_client_secret.get_secret_value()):
        problems.append("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together.")
    if s.google_client_id and not s.api_public_url.startswith("https://"):
        problems.append("API_PUBLIC_URL must be an https:// origin when Google sign-in is on.")
    if (
        s.google_auth_url != "https://accounts.google.com/o/oauth2/v2/auth"
        or s.google_token_url != "https://oauth2.googleapis.com/token"  # noqa: S105
    ):
        problems.append("GOOGLE_AUTH_URL and GOOGLE_TOKEN_URL are for local tests only.")
    if s.api_public_url != DEFAULT_API_URL and not same_site(s.web_origin, s.api_public_url):
        problems.append(
            "WEB_ORIGIN and API_PUBLIC_URL must be on the same site (for example app.example.com "
            "and api.example.com). On separate platform subdomains such as *.up.railway.app "
            "browsers drop the login cookie, so nobody could stay signed in. Use custom domains."
        )
    if s.dev_log_email_links and s.environment == "production":
        problems.append("DEV_LOG_EMAIL_LINKS must be off in production (it prints sign-in links).")
    if not s.dev_log_email_links and (not s.resend_api_key.get_secret_value() or not s.email_from):
        problems.append("RESEND_API_KEY and EMAIL_FROM must be set (sign-in links are emailed).")
    if s.environment == "production" and not s.openai_api_key.get_secret_value():
        problems.append("OPENAI_API_KEY is not set (research, transcription and answers need it).")
    problems += _autoapply_problems(s)
    return problems


def _autoapply_problems(s: Settings) -> list[str]:
    """Auto-Apply writes to real employers: a half-configured server must not start."""
    if not s.autoapply_enabled:
        return []
    out: list[str] = []
    real_mail = s.autoapply_mailbox_provider == "gmail"
    if real_mail and not (s.gmail_client_id and s.gmail_client_secret.get_secret_value()):
        out.append(
            "AUTOAPPLY_MAILBOX_PROVIDER=gmail needs GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET."
        )
    if (
        real_mail or s.autoapply_email_dispatch or s.autoapply_outreach_dispatch
    ) and s.environment == "production":
        if not s.mailbox_encryption_key.get_secret_value():
            out.append("MAILBOX_ENCRYPTION_KEY must be set: mailbox tokens are stored encrypted.")
    if s.environment != "production" and (
        s.autoapply_form_dispatch or s.autoapply_email_dispatch or s.autoapply_outreach_dispatch
    ):
        if not s.autoapply_allowed_recipients:
            out.append(
                "Real Auto-Apply sending outside production needs AUTOAPPLY_ALLOWED_RECIPIENTS, "
                "so a test can never reach a real employer."
            )
    if s.environment == "production" and "fixture" in s.autoapply_discovery_sources.split(","):
        out.append("AUTOAPPLY_DISCOVERY_SOURCES must not include the fixture in production.")
    if s.environment == "production" and s.autoapply_sample_jobs:
        out.append("AUTOAPPLY_SAMPLE_JOBS is demo mode and must be off in production.")
    from app.autoapply.discovery import KNOWN_SOURCES

    unknown = [
        n
        for n in s.autoapply_discovery_sources.split(",")
        if n.strip() and n.strip() not in KNOWN_SOURCES
    ]
    if unknown:
        out.append(f"AUTOAPPLY_DISCOVERY_SOURCES has unknown names: {', '.join(unknown)}.")
    if s.autoapply_mailbox_provider not in ("fixture", "gmail"):
        out.append("AUTOAPPLY_MAILBOX_PROVIDER must be fixture or gmail.")
    return out


def assert_safe(s: Settings) -> None:
    problems = validate_settings(s)
    if problems:
        raise RuntimeError("Unsafe configuration:\n- " + "\n- ".join(problems))


def _error(status: int, code: str, message: str, headers: list[tuple[bytes, bytes]]) -> Message:
    body = json.dumps(
        {"error": {"code": code, "message": message, "request_id": request_id_var.get()}}
    ).encode()
    return {
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json"), *headers],
        "_body": body,
    }


async def _send_error(send: Send, status: int, code: str, message: str, extra: Any = ()) -> None:
    start = _error(status, code, message, list(extra))
    body = start.pop("_body")
    await send(start)
    await send({"type": "http.response.body", "body": body})


class SecurityHeadersMiddleware:
    """Headers on every HTTP response. API responses are JSON or event streams, never pages, so the
    CSP forbids everything; the web app's own CSP is set by its web server."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.hsts = settings.environment != "local"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers: MutableMapping[str, str] = {
                    "x-content-type-options": "nosniff",
                    "referrer-policy": "no-referrer",
                    "x-frame-options": "DENY",
                    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
                    "cross-origin-resource-policy": "same-site",
                }
                if self.hsts:
                    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains"
                if path.startswith("/api/"):
                    headers["cache-control"] = "no-store"  # private data is never cached
                existing = {k.lower() for k, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [
                    (k.encode(), v.encode())
                    for k, v in headers.items()
                    if k.encode() not in existing
                ]
            await send(message)

        await self.app(scope, receive, wrapped)


class BodyLimitMiddleware:
    """Reject request bodies over the limit: by Content-Length when given, and by counting bytes
    when the client streams without one."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.default = settings.max_body_bytes
        self.audio = settings.max_audio_body_bytes
        self.cv = settings.max_cv_body_bytes

    def limit_for(self, path: str) -> int:
        if path.endswith("/notes/cv"):
            return self.cv
        return self.audio if path.endswith("/segment") else self.default

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return
        limit = self.limit_for(scope.get("path", ""))
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await _send_error(send, 413, "body_too_large", "That request is too large.")
            return
        seen = 0
        too_big = False

        async def counting() -> Message:
            nonlocal seen, too_big
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > limit:
                    too_big = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return msg

        started = False

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if too_big and message["type"] == "http.response.start" and not started:
                started = True
                await _send_error(send, 413, "body_too_large", "That request is too large.")
                return
            if too_big and started:
                return  # drop the rest of the app's own response
            await send(message)

        await self.app(scope, counting, guarded_send)


class RateLimiter:
    """Sliding-window counter per key, in memory. Each API replica keeps its own counts, so the
    effective limit is per replica; fine for abuse control, not for billing."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._clock = clock

    def check(self, key: str, limit: int, window: float = 60.0) -> float | None:
        """Record a hit. Returns None if allowed, else seconds until the client may retry."""
        now = self._clock()
        q = self._hits[key]
        while q and now - q[0] >= window:
            q.popleft()
        if len(q) >= limit:
            return float(max(0.1, window - (now - q[0])))
        q.append(now)
        if len(self._hits) > 50_000:  # bound memory under a flood of distinct clients
            self._prune(now, window)
        return None

    def _prune(self, now: float, window: float) -> None:
        for k in [k for k, q in self._hits.items() if not q or now - q[-1] >= window]:
            del self._hits[k]


class RateLimitMiddleware:
    EXEMPT = ("/healthz", "/readyz", "/metrics")

    def __init__(
        self, app: ASGIApp, settings: Settings, limiter: RateLimiter | None = None
    ) -> None:
        self.app = app
        self.s = settings
        self.limiter = limiter or RateLimiter()

    def client_key(self, scope: Scope) -> str:
        headers = dict(scope["headers"])
        if self.s.trust_proxy_headers:
            fwd = forwarded_client_ip(headers.get(b"x-forwarded-for", b"").decode())
            if fwd:
                return fwd
        client = scope.get("client")
        return str(client[0]) if client else "unknown"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if scope["type"] != "http" or not path.startswith("/api/") or path in self.EXEMPT:
            await self.app(scope, receive, send)
            return
        key = self.client_key(scope)
        if path == "/api/notes/cv":
            wait = self.limiter.check(f"cv:{key}", self.s.rate_limit_upload_per_minute)
        elif path.startswith("/api/auth/") and path != "/api/auth/providers":
            wait = self.limiter.check(f"auth:{key}", self.s.rate_limit_auth_per_minute)
        else:
            wait = self.limiter.check(f"api:{key}", self.s.rate_limit_per_minute)
        if wait is not None:
            await _send_error(
                send,
                429,
                "rate_limited",
                "Too many requests. Slow down and try again shortly.",
                [(b"retry-after", str(int(wait) + 1).encode())],
            )
            return
        await self.app(scope, receive, send)


class MetricsMiddleware:
    """Counts requests and times them by ROUTE TEMPLATE (never the raw path, which holds ids)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        from app import metrics

        start = time.perf_counter()
        status = 500

        async def wrapped(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, wrapped)
        finally:
            route = scope.get("route")
            template = getattr(route, "path", None) or "unmatched"
            metrics.http_requests.labels(scope["method"], template, str(status)).inc()
            metrics.http_duration.labels(template).observe(time.perf_counter() - start)
