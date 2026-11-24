"""Mailbox credentials are encrypted, and setting a real key later must not lock out mailboxes that
were saved before it existed."""

from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr

from app.autoapply import crypto, mailbox
from app.autoapply.adapters import AdapterError
from app.config import Settings

KEY = Fernet.generate_key().decode()  # a throwaway key for these tests only


def make(env: str, key: str = "") -> Settings:
    return Settings(  # type: ignore[call-arg]
        environment=env, cookie_secret=SecretStr("c" * 32), mailbox_encryption_key=SecretStr(key)
    )


def test_a_mailbox_saved_before_the_key_was_set_still_opens_outside_production():
    before = crypto.encrypt(make("dev"), "refresh-1")  # no key yet: the derived one
    after = make("dev", KEY)
    assert crypto.decrypt(after, before) == "refresh-1"
    fresh = crypto.encrypt(after, "refresh-2")  # new values use the real key
    assert crypto.decrypt(after, fresh) == "refresh-2"
    with pytest.raises(crypto.CryptoError):  # and the derived key alone cannot open those
        crypto.decrypt(make("dev"), fresh)


def test_production_has_no_fallback_and_needs_its_key():
    before = crypto.encrypt(make("dev"), "refresh-1")
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt(make("production", KEY), before)
    with pytest.raises(crypto.CryptoError):
        crypto.encrypt(make("production"), "x")
    prod = make("production", KEY)
    assert crypto.decrypt(prod, crypto.encrypt(prod, "x")) == "x"


def test_an_unreadable_credential_asks_to_reconnect_instead_of_crashing():
    broken = SimpleNamespace(status="connected", token_encrypted="not-a-real-token")
    with pytest.raises(AdapterError) as e:
        mailbox.token(make("dev", KEY), broken)  # type: ignore[arg-type]
    assert e.value.code == "reauth" and "Connect it again" in e.value.message
