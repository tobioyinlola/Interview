"""Recognising the same device, so inviting yourself from a second email does not count.

Three signals, each kept only as a keyed hash (never the raw value):
  * a random id in a long-lived cookie: the same browser, however many emails are used in it;
  * a coarse fingerprint of the device sent by the web app (screen size, time zone, language, and a
    few hardware facts): the same machine in another browser or a private window;
  * the network address, when the server is told it can trust the proxy's forwarded address.
A cookie match is enough. A fingerprint match counts only together with the same network address,
because many different people own the same laptop model and live in the same time zone."""

import re
import secrets
from dataclasses import dataclass

from fastapi import Request, Response

from app.config import Settings
from app.security import hash_token

DEVICE_COOKIE = "device_id"
PRINT_HEADER = "x-device-fp"
_COOKIE_OK = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
_PRINT_OK = re.compile(r"^[0-9a-f]{64}$")
TWO_YEARS = 60 * 60 * 24 * 730


@dataclass(frozen=True)
class DeviceInfo:
    cookie_hash: str | None = None
    print_hash: str | None = None
    ip_hash: str | None = None

    def is_empty(self) -> bool:
        return not (self.cookie_hash or self.print_hash or self.ip_hash)


def same_device(a: DeviceInfo, b: DeviceInfo) -> bool:
    """True when two sightings are very probably the same machine."""
    if a.cookie_hash and a.cookie_hash == b.cookie_hash:
        return True
    return bool(
        a.print_hash and a.print_hash == b.print_hash and a.ip_hash and a.ip_hash == b.ip_hash
    )


def _client_ip(request: Request, settings: Settings) -> str | None:
    """The caller's address, but only when forwarded addresses may be trusted. Behind the web
    service's proxy every request otherwise seems to come from the proxy, which would make all
    fingerprints look alike."""
    if not settings.trust_proxy_headers:
        return None
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return fwd or None


def observe_device(request: Request, response: Response | None, settings: Settings) -> DeviceInfo:
    """Who is calling, as hashes. Gives the browser a device id cookie if it has none."""
    secret = settings.cookie_secret.get_secret_value()
    raw = request.cookies.get(DEVICE_COOKIE, "")
    if not _COOKIE_OK.match(raw):
        raw = secrets.token_urlsafe(24)
        if response is not None:
            response.set_cookie(
                DEVICE_COOKIE,
                raw,
                max_age=TWO_YEARS,
                httponly=True,
                secure=settings.environment != "local",
                samesite="lax",
                path="/",
            )
    fp = request.headers.get(PRINT_HEADER, "").strip().lower()
    ip = _client_ip(request, settings)
    return DeviceInfo(
        cookie_hash=hash_token(f"cookie:{raw}", secret),
        print_hash=hash_token(f"print:{fp}", secret) if _PRINT_OK.match(fp) else None,
        ip_hash=hash_token(f"ip:{ip}", secret) if ip else None,
    )
