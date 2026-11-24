"""SSRF-safe page fetcher with text extraction.

For each page, in order: validate the link; resolve the host and require every address to be
public; connect to the address that was checked (so a host name that changes between the check
and the connection cannot redirect us); follow redirects one hop at a time, repeating all checks;
stop at the size and time limits; keep only HTML or plain text; obey robots.txt; send an honest
user agent; and send at most one request per second to a host."""

import asyncio
import logging
import re
import ssl
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html import unescape
from typing import Literal
from urllib.parse import SplitResult, unquote, urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx
import trafilatura

from app.services.url_guard import (
    IPAddress,
    Resolver,
    UrlRejected,
    normalize_url,
    resolve_public,
    system_resolver,
    validate_url_syntax,
)

log = logging.getLogger("app.fetcher")

Status = Literal["ok", "blocked", "login_required", "too_large", "timeout", "disallowed"]
_REDIRECTS = {301, 302, 303, 307, 308}
_LOGIN_HINTS = ("login", "signin", "sign-in", "sign_in", "sso", "/auth", "authenticate")
_ROBOTS_MAX_BYTES = 512 * 1024
_ROBOTS_TTL = 3600.0
MIN_READABLE_CHARS = 80


@dataclass
class FetchResult:
    url: str
    status: Status
    reason: str = ""
    title: str = ""
    text: str = ""
    final_url: str = ""
    emails: tuple[str, ...] = ()  # addresses the page itself publishes (mailto links and text)
    links: tuple[tuple[str, str], ...] = ()  # (link text, absolute address) for links on the page


_MAILTO = re.compile(r"mailto:([^\"'?<>\s&]+)", re.IGNORECASE)
_ADDR = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")


def published_emails(html: str) -> tuple[str, ...]:
    """Addresses written on the page, in the order found, from links and visible text alike
    (the readable-text pass drops footers, where contact addresses usually are)."""
    plain = unescape(re.sub(r"<(script|style)\b.*?</\1>", " ", html, flags=re.S | re.I))
    found: list[str] = []
    for m in _MAILTO.findall(plain) + _ADDR.findall(re.sub(r"<[^>]+>", " ", plain)):
        addr = unquote(m).strip().lower().rstrip(".")
        if _ADDR.fullmatch(addr) and addr not in found:
            found.append(addr)
    return tuple(found[:20])


_ANCHOR = re.compile(r"<a\b[^>]*?href\s*=\s*[\"']([^\"'#][^\"']*)[\"'][^>]*>(.*?)</a>", re.S | re.I)


def page_links(html: str, base: str) -> tuple[tuple[str, str], ...]:
    """Links on the page as (visible text, absolute http address). Used to find a startup's careers
    page and the address of each opening it lists."""
    out: list[tuple[str, str]] = []
    for href, inner in _ANCHOR.findall(html):
        href = unescape(href).strip()
        if href.lower().startswith(("mailto:", "tel:", "javascript:")):
            continue
        text = " ".join(unescape(re.sub(r"<[^>]+>", " ", inner)).split())[:160]
        url = urljoin(base, href)
        if text and url.startswith(("http://", "https://")) and (text, url) not in out:
            out.append((text, url))
    return tuple(out[:150])


class _TooLarge(Exception):
    pass


@dataclass
class _Raw:
    status_code: int
    headers: httpx.Headers
    body: bytes


class Fetcher:
    def __init__(
        self,
        *,
        resolver: Resolver = system_resolver,
        transport: httpx.AsyncBaseTransport | None = None,
        verify: ssl.SSLContext | bool = True,
        user_agent: str = "MeetPracticeAssistant/0.1",
        timeout: float = 10.0,
        max_bytes: int = 2 * 1024 * 1024,
        max_redirects: int = 3,
        host_interval: float = 1.0,
        text_max_chars: int = 20_000,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.resolver = resolver
        self.transport = transport
        self.verify = verify
        self.user_agent = user_agent
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.max_redirects = max_redirects
        self.host_interval = host_interval
        self.text_max_chars = text_max_chars
        self._sleep = sleep
        self._clock = clock
        self._host_locks: dict[str, asyncio.Lock] = {}
        self._last_request: dict[str, float] = {}
        self._robots: dict[str, tuple[float, RobotFileParser | bool]] = {}

    # ------------------------------------------------------------------ public

    async def fetch(self, url: str) -> FetchResult:
        """Never raises: every failure becomes a status with a plain-language reason."""
        try:
            async with asyncio.timeout(self.timeout):
                return await self._fetch(url)
        except TimeoutError:
            return FetchResult(url, "timeout", "The page took too long to respond.")
        except httpx.TimeoutException:
            return FetchResult(url, "timeout", "The page took too long to respond.")
        except httpx.TransportError:
            return FetchResult(url, "blocked", "Couldn't connect to the page.")
        except Exception as exc:  # defensive: one bad page must never fail the whole job
            log.warning("fetch failed", extra={"fields": {"error": type(exc).__name__}})
            return FetchResult(url, "blocked", "Couldn't read the page.")

    # ---------------------------------------------------------------- internals

    async def _fetch(self, url: str) -> FetchResult:
        current = url
        for hop in range(self.max_redirects + 1):
            try:
                parts = validate_url_syntax(current)
                ips = await self._public_ips(parts)
            except UrlRejected as exc:
                return FetchResult(url, "blocked", exc.message)

            if not await self._robots_allows(parts, ips):
                return FetchResult(url, "disallowed", "The site's robots.txt asks not to be read.")

            try:
                raw = await self._request(parts, ips, self.max_bytes)
            except _TooLarge:
                return FetchResult(url, "too_large", "The page is larger than 2 MB.")

            if raw.status_code in _REDIRECTS:
                location = raw.headers.get("location")
                if not location:
                    return FetchResult(url, "blocked", "The page redirected nowhere.")
                nxt = urljoin(current, location)
                if hop >= self.max_redirects:
                    return FetchResult(url, "blocked", "The page redirected too many times.")
                if any(h in urlsplit(nxt).path.lower() for h in _LOGIN_HINTS):
                    return FetchResult(url, "login_required", "The page needs you to sign in.")
                current = nxt  # every hop is re-validated at the top of the loop
                continue
            return await self._interpret(url, current, raw)
        return FetchResult(url, "blocked", "The page redirected too many times.")

    async def _interpret(self, url: str, final_url: str, raw: _Raw) -> FetchResult:
        code = raw.status_code
        if code == 401:
            return FetchResult(url, "login_required", "The page needs you to sign in.")
        if code in (403, 429):
            return FetchResult(url, "blocked", "The site blocked the request.")
        if code in (404, 410):
            return FetchResult(url, "blocked", "The page was not found.")
        if code >= 400:
            return FetchResult(url, "blocked", f"The site returned an error ({code}).")

        ctype = raw.headers.get("content-type", "").split(";")[0].strip().lower()
        if ctype not in ("text/html", "text/plain", "application/xhtml+xml"):
            return FetchResult(url, "blocked", "That link is not a web page.")

        encoding = httpx.Response(200, headers=raw.headers).charset_encoding or "utf-8"
        html = raw.body.decode(encoding, errors="replace")
        if ctype == "text/plain":
            title, text = "", html.strip()
        else:
            title, text = await asyncio.to_thread(_extract, html)
        text = text[: self.text_max_chars]
        emails = published_emails(html) if ctype != "text/plain" else ()
        links = page_links(html, final_url) if ctype != "text/plain" else ()
        if len(text) < MIN_READABLE_CHARS and emails:
            return FetchResult(
                url, "ok", title=title, text=text, final_url=final_url, emails=emails, links=links
            )
        if len(text) < MIN_READABLE_CHARS:
            return FetchResult(
                url,
                "blocked",
                "No readable text was found. The page may need JavaScript or a sign-in.",
                final_url=final_url,
            )
        return FetchResult(url, "ok", title=title, text=text, final_url=final_url, emails=emails)

    async def _public_ips(self, parts: SplitResult) -> list[IPAddress]:
        port = parts.port or (443 if parts.scheme == "https" else 80)
        return await resolve_public((parts.hostname or "").rstrip(".").lower(), port, self.resolver)

    async def _request(self, parts: SplitResult, ips: list[IPAddress], limit: int) -> _Raw:
        """One GET, connected to a checked address. Redirects are not followed here."""
        host = (parts.hostname or "").rstrip(".").lower()
        lock = self._host_locks.setdefault(host, asyncio.Lock())
        async with lock:
            wait = self.host_interval - (self._clock() - self._last_request.get(host, -1e9))
            if wait > 0:
                await self._sleep(wait)
            self._last_request[host] = self._clock()

            last_error: Exception | None = None
            for ip in ips:
                try:
                    return await self._get_via_ip(parts, host, ip, limit)
                except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
                    last_error = exc  # try the next checked address
            raise last_error or httpx.ConnectError("no address")

    async def _get_via_ip(self, parts: SplitResult, host: str, ip: IPAddress, limit: int) -> _Raw:
        ip_text = f"[{ip}]" if ip.version == 6 else str(ip)
        port = f":{parts.port}" if parts.port else ""
        path = parts.path or "/"
        target = f"{parts.scheme}://{ip_text}{port}{path}" + (
            f"?{parts.query}" if parts.query else ""
        )
        headers = {
            "Host": host + port,
            "User-Agent": self.user_agent,
            "Accept": "text/html,text/plain;q=0.9",
            "Accept-Encoding": "gzip",
        }
        async with httpx.AsyncClient(
            transport=self.transport,
            verify=self.verify,
            follow_redirects=False,
            timeout=self.timeout,
        ) as client:
            # sni_hostname makes TLS present and verify the real host name while we connect to
            # the IP address we already checked.
            async with client.stream(
                "GET", target, headers=headers, extensions={"sni_hostname": host}
            ) as resp:
                declared = resp.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > limit:
                    raise _TooLarge
                chunks: list[bytes] = []
                size = 0
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > limit:
                        raise _TooLarge
                    chunks.append(chunk)
                return _Raw(resp.status_code, resp.headers, b"".join(chunks))

    async def _robots_allows(self, parts: SplitResult, ips: list[IPAddress]) -> bool:
        key = f"{parts.scheme}://{(parts.hostname or '').lower()}:{parts.port or ''}"
        cached = self._robots.get(key)
        now = self._clock()
        if cached is None or now - cached[0] > _ROBOTS_TTL:
            cached = (now, await self._load_robots(parts, ips))
            self._robots[key] = cached
        parser = cached[1]
        if isinstance(parser, bool):
            return parser
        return parser.can_fetch(self.user_agent, normalize_url(parts))

    async def _load_robots(
        self, parts: SplitResult, ips: list[IPAddress]
    ) -> RobotFileParser | bool:
        """RFC 9309: a missing robots.txt (4xx) allows everything; an unreachable one (5xx or a
        network failure) disallows everything."""
        robots_parts = urlsplit(f"{parts.scheme}://{parts.netloc}/robots.txt")
        try:
            raw = await self._request(robots_parts, ips, _ROBOTS_MAX_BYTES)
        except _TooLarge:
            return True
        except httpx.HTTPError:
            return False
        if raw.status_code >= 500:
            return False
        if raw.status_code >= 400 or raw.status_code in _REDIRECTS:
            return True
        parser = RobotFileParser()
        parser.parse(raw.body.decode("utf-8", errors="replace").splitlines())
        return parser


def _extract(html: str) -> tuple[str, str]:
    """Main readable text and title of an HTML page (CPU-bound, so run in a thread)."""
    text = trafilatura.extract(html, include_comments=False, include_tables=True) or ""
    meta = trafilatura.extract_metadata(html)
    title = (meta.title if meta and meta.title else "") or ""
    return title.strip(), text.strip()
