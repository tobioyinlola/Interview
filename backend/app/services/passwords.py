"""Password hashing and rules.

Hashing is scrypt (memory-hard, in the standard library) with a random salt per password. It takes
about a tenth of a second and 32 MB, so it runs in a worker thread, never on the event loop. Rules
follow current guidance: length matters, composition rules do not, and the most common passwords
are refused."""

import asyncio
import base64
import hashlib
import hmac
import secrets

N, R, P, DKLEN = 2**15, 8, 1, 32
MAXMEM = 64 * 1024 * 1024
MIN_LENGTH, MAX_LENGTH = 10, 128

# The most guessed passwords that already meet the length rule, plus obvious service words.
COMMON = {
    "1234567890", "12345678910", "123456789012", "0123456789", "1111111111", "0000000000",
    "qwertyuiop", "qwerty1234", "qwerty12345", "1q2w3e4r5t", "1qaz2wsx3e", "asdfghjkl1",
    "password1", "password12", "password123", "password1234", "password12345", "passw0rd123",
    "iloveyou12", "iloveyou123", "welcome123", "welcome1234", "letmein123", "letmein1234",
    "admin12345", "administrator", "abcdefghij", "abcd123456", "abc1234567", "changeme123",
    "interviewmeet", "interviewmeet1", "interviewmeet123", "practice123", "practice1234",
    "monkey1234", "dragon1234", "football123", "baseball123", "superman123", "trustno1234",
}  # fmt: skip


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=DKLEN, maxmem=MAXMEM)
    return f"scrypt${N}${R}${P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(digest)
        got = hashlib.scrypt(
            password.encode(),
            salt=base64.b64decode(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
            maxmem=MAXMEM,
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got, expected)


# A real hash of a throwaway password, so a login for an unknown email costs the same as a real one.
_DUMMY = hash_password(secrets.token_urlsafe(16))


async def hash_password_async(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)


async def verify_password_async(password: str, stored: str | None) -> bool:
    ok = await asyncio.to_thread(verify_password, password, stored or _DUMMY)
    return ok and stored is not None


def password_problem(password: str, email: str = "") -> str | None:
    """Why this password is not acceptable, in words for the person typing it. None means fine."""
    if len(password) < MIN_LENGTH:
        return f"Use at least {MIN_LENGTH} characters."
    if len(password) > MAX_LENGTH:
        return f"Use at most {MAX_LENGTH} characters."
    folded = password.strip().lower()
    local = email.split("@")[0].lower()
    if folded in COMMON or len(set(folded)) <= 2:
        return "That password is too easy to guess. Try a few words together."
    if email and (folded == email.lower() or (len(local) >= 4 and folded == local)):
        return "Your password can't be your email address."
    return None
