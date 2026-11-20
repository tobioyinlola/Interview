"""Invite codes, and the rule that a person cannot invite themselves."""

import re
import secrets

# No 0/o/1/l/i: a code read aloud or typed from a screenshot is not mistaken.
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
_VALID = re.compile(r"^[a-z0-9]{4,16}$")
GMAIL = {"gmail.com", "googlemail.com"}


def new_referral_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(8))


def clean_code(raw: str | None) -> str | None:
    """A code as typed or found in a link, or None when it cannot be a code."""
    code = (raw or "").strip().lower()
    return code if _VALID.match(code) else None


def canonical_email(email: str) -> str:
    """One mailbox, however it is written: no +tag, and no dots or googlemail for Gmail. Used to
    spot someone inviting themselves with a second address; it is not used to sign anyone in."""
    local, _, domain = email.strip().lower().partition("@")
    local = local.split("+", 1)[0]
    if domain in GMAIL:
        local, domain = local.replace(".", ""), "gmail.com"
    return f"{local}@{domain}"
