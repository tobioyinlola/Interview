"""Opaque random tokens, stored only as keyed hashes so a database leak cannot be replayed."""

import hashlib
import hmac
import secrets
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from starlette.requests import Request

COOKIE_NAME = "session"
STAFF_COOKIE_NAME = "staff_session"  # the back office has its own, separate sign-in
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "meet-practice"


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str, secret: str) -> str:
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()


# The installed apps carry their own interface, so they are a different origin from the API and
# cannot use the browser's session cookie. They ask for a token instead (x-client: app) and send it
# back as "Authorization: Bearer". Nothing here changes how the website signs in.
APP_CLIENT_HEADER = "x-client"
SESSION_TOKEN_HEADER = "x-session-token"  # noqa: S105


def wants_token(request: "Request") -> bool:
    return request.headers.get(APP_CLIENT_HEADER, "").lower() == "app"


def bearer_token(request: "Request") -> str | None:
    value = request.headers.get("authorization", "")
    scheme, _, token = value.partition(" ")
    return token.strip() or None if scheme.lower() == "bearer" else None


def session_token(request: "Request") -> str | None:
    """The signed-in session, from the browser cookie or an app's bearer token."""
    return request.cookies.get(COOKIE_NAME) or bearer_token(request)
