"""Encryption for mailbox tokens. A leaked database dump alone must not give anyone a mailbox."""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.config import Settings


class CryptoError(Exception):
    """The stored value cannot be read (wrong key, or damaged)."""


def _derived(settings: Settings) -> Fernet:
    """Development and tests only: a key derived from the cookie secret, so nothing is stored in
    the clear but no setup is needed."""
    digest = hashlib.sha256(b"mailbox:" + settings.cookie_secret.get_secret_value().encode())
    return Fernet(base64.urlsafe_b64encode(digest.digest()))


def _fernets(settings: Settings) -> list[Fernet]:
    """The keys to try, first one used for new values. Outside production the derived key stays as
    a fallback, so a mailbox saved before MAILBOX_ENCRYPTION_KEY was set still opens."""
    key = settings.mailbox_encryption_key.get_secret_value()
    if settings.environment == "production":
        if not key:
            raise CryptoError("MAILBOX_ENCRYPTION_KEY is not set")
        return [Fernet(key.encode())]
    return [Fernet(key.encode()), _derived(settings)] if key else [_derived(settings)]


def encrypt(settings: Settings, plain: str) -> str:
    return _fernets(settings)[0].encrypt(plain.encode()).decode()


def decrypt(settings: Settings, token: str) -> str:
    try:
        return MultiFernet(_fernets(settings)).decrypt(token.encode()).decode()
    except InvalidToken:
        raise CryptoError("stored credential cannot be decrypted") from None
