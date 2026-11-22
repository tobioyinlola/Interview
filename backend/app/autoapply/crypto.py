"""Encryption for mailbox tokens. A leaked database dump alone must not give anyone a mailbox."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings


class CryptoError(Exception):
    """The stored value cannot be read (wrong key, or damaged)."""


def _fernet(settings: Settings) -> Fernet:
    key = settings.mailbox_encryption_key.get_secret_value()
    if key:
        return Fernet(key.encode())
    if settings.environment == "production":
        raise CryptoError("MAILBOX_ENCRYPTION_KEY is not set")
    # Development and tests only: a key derived from the cookie secret, so nothing is stored
    # in the clear but no setup is needed.
    digest = hashlib.sha256(b"mailbox:" + settings.cookie_secret.get_secret_value().encode())
    return Fernet(base64.urlsafe_b64encode(digest.digest()))


def encrypt(settings: Settings, plain: str) -> str:
    return _fernet(settings).encrypt(plain.encode()).decode()


def decrypt(settings: Settings, token: str) -> str:
    try:
        return _fernet(settings).decrypt(token.encode()).decode()
    except InvalidToken:
        raise CryptoError("stored credential cannot be decrypted") from None
