"""Decides whether a user-supplied link may be fetched. Public http(s) pages only.

Every rule here exists to stop server-side request forgery: a link that makes our server call
localhost, a private network or a cloud metadata address. The same checks run at form time and,
again, on every hop of every fetch (see fetcher.py)."""

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from urllib.parse import SplitResult, urlsplit, urlunsplit

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
Resolver = Callable[[str, int], Awaitable[list[str]]]

ALLOWED_PORTS = {80, 443}
MAX_URL_LENGTH = 2048

# Not covered by `is_global` on every Python version, or able to embed a private IPv4 address.
_EXTRA_BLOCKED = [
    ipaddress.ip_network(n)
    for n in (
        "64:ff9b::/96",  # NAT64: wraps IPv4, including private ranges
        "64:ff9b:1::/48",
        "2002::/16",  # 6to4: embeds an IPv4 address
        "2001::/32",  # Teredo
        "100.64.0.0/10",  # carrier-grade NAT
        "192.0.0.0/24",
        "198.18.0.0/15",
        "fec0::/10",  # deprecated site-local
    )
]

# People, not organisations: research covers companies only.
_PERSONAL_HOSTS = {
    "instagram.com",
    "facebook.com",
    "tiktok.com",
    "x.com",
    "twitter.com",
}
_LINKEDIN_PERSONAL_PREFIXES = ("/in/", "/pub/", "/profile/")


class UrlRejected(Exception):
    """The link may not be fetched. `message` is safe and plain enough to show to the user."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def ip_is_allowed(ip: IPAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped  # ::ffff:127.0.0.1 is loopback in disguise
    if not ip.is_global or ip.is_multicast:
        return False
    return not any(ip in net for net in _EXTRA_BLOCKED if net.version == ip.version)


def _literal_ip(host: str) -> IPAddress | None:
    """Parse an IP written as text, including the legacy forms browsers accept
    (decimal 2130706433, hex 0x7f000001, short 127.1)."""
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        pass
    try:
        return ipaddress.IPv4Address(socket.inet_aton(host))
    except (OSError, ValueError):
        return None


def _is_domain_or_subdomain(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def validate_url_syntax(raw: str) -> SplitResult:
    """Check everything that can be checked without the network. Returns the parsed URL."""
    raw = raw.strip()
    if not raw or len(raw) > MAX_URL_LENGTH:
        raise UrlRejected("Enter a link of up to 2,000 characters.")
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError:
        raise UrlRejected("That doesn't look like a valid link.") from None
    if parts.scheme not in {"http", "https"}:
        raise UrlRejected("Only http and https links are supported.")
    if parts.username or parts.password:
        raise UrlRejected("Links that contain a username or password are not supported.")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise UrlRejected("That link has no website address.")
    effective_port = port or (443 if parts.scheme == "https" else 80)
    if effective_port not in ALLOWED_PORTS:
        raise UrlRejected("Only the standard web ports (80 and 443) are supported.")

    literal = _literal_ip(host)
    if literal is not None:
        if not ip_is_allowed(literal):
            raise UrlRejected("Links to private or local network addresses are not allowed.")
    else:
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan")):
            raise UrlRejected("Links to localhost or local networks are not allowed.")
        if "." not in host:
            raise UrlRejected("That link is not a public website address.")

    if any(_is_domain_or_subdomain(host, d) for d in _PERSONAL_HOSTS):
        raise UrlRejected("Social profile links aren't supported. Paste the text you need instead.")
    if _is_domain_or_subdomain(host, "linkedin.com") and parts.path.lower().startswith(
        _LINKEDIN_PERSONAL_PREFIXES
    ):
        raise UrlRejected("Links to personal profiles aren't supported. Research covers companies.")
    return parts


def normalize_url(parts: SplitResult) -> str:
    """Lower-case host, drop the fragment, so equal pages share one cache key."""
    host = (parts.hostname or "").rstrip(".").lower()
    if ":" in host:  # bare IPv6 literal needs brackets again
        host = f"[{host}]"
    netloc = host + (f":{parts.port}" if parts.port else "")
    return urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))


async def system_resolver(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    seen: list[str] = []
    for info in infos:
        addr = str(info[4][0]).split("%")[0]  # strip IPv6 zone id
        if addr not in seen:
            seen.append(addr)
    return seen


async def resolve_public(host: str, port: int, resolver: Resolver) -> list[IPAddress]:
    """Resolve a host and require that EVERY address is public. A host that resolves to even one
    private address is refused, so a split answer cannot sneak through."""
    literal = _literal_ip(host)
    try:
        raw = [str(literal)] if literal is not None else await resolver(host, port)
    except OSError:
        raise UrlRejected("That website address could not be found.") from None
    if not raw:
        raise UrlRejected("That website address could not be found.")
    ips = [ipaddress.ip_address(a) for a in raw]
    if not all(ip_is_allowed(ip) for ip in ips):
        raise UrlRejected("Links to private or local network addresses are not allowed.")
    return ips


async def validate_public_url(raw: str, resolver: Resolver = system_resolver) -> str:
    """Full check used when a link is saved. Returns the normalised URL or raises UrlRejected."""
    parts = validate_url_syntax(raw)
    port = parts.port or (443 if parts.scheme == "https" else 80)
    host = (parts.hostname or "").rstrip(".").lower()
    await resolve_public(host, port, resolver)
    return normalize_url(parts)
