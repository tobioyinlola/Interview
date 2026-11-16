"""Opaque random tokens, stored only as keyed hashes so a database leak cannot be replayed."""

import hashlib
import hmac
import secrets

COOKIE_NAME = "session"
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "meet-practice"


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str, secret: str) -> str:
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()
