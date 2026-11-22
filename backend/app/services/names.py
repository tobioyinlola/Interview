"""Names people give us. They end up in greetings and emails, so they are cleaned and limited."""

import re
import unicodedata

MAX_NAME = 120
_ALLOWED_PUNCTUATION = set("'\u2019.-,")


def clean_name(raw: str | None) -> str | None:
    """A tidy full name, or None if there is nothing usable. Letters (any alphabet), accents,
    spaces and the punctuation names use (apostrophe, hyphen, full stop, comma) are kept."""
    if not raw:
        return None
    text = unicodedata.normalize("NFC", raw)
    text = re.sub(r"\s+", " ", text).strip()
    if not text or len(text) > MAX_NAME:
        return None
    for ch in text:
        cat = unicodedata.category(ch)
        if not (cat[0] in "LM" or ch == " " or ch in _ALLOWED_PUNCTUATION):
            return None
    if not any(unicodedata.category(ch)[0] == "L" for ch in text):
        return None
    return text


def first_name(full_name: str | None) -> str | None:
    """The first word of a name, for greetings."""
    if not full_name:
        return None
    return full_name.split(" ")[0].strip(",.") or None


def clean_phone(raw: str | None) -> str | None:
    """A phone number as people write it (+234 801 234 5678), or None when empty. Raises ValueError
    when it is not a plausible number."""
    text = re.sub(r"\s+", " ", (raw or "").strip())
    if not text:
        return None
    digits = re.sub(r"\D", "", text)
    if not re.fullmatch(r"\+?[\d ()\-.]+", text) or not 7 <= len(digits) <= 15:
        raise ValueError("Enter a phone number with 7 to 15 digits, for example +234 801 234 5678.")
    return text[:30]


def clean_line(raw: str | None, limit: int = 120) -> str | None:
    """A short single line of text (a place, a job title). None when empty; ValueError if it holds
    control characters or is too long."""
    text = re.sub(r"\s+", " ", (raw or "").strip())
    if not text:
        return None
    if len(text) > limit or any(unicodedata.category(c)[0] == "C" for c in text):
        raise ValueError(f"Keep this under {limit} characters, with no special characters.")
    return text


def clean_profile_url(raw: str | None) -> str | None:
    """A web address starting with https:// (or http://), or None when empty."""
    text = (raw or "").strip()
    if not text:
        return None
    if "linkedin" in text and not text.startswith(("http://", "https://")):
        text = "https://" + text
    if not re.fullmatch(r"https?://[^\s<>\"']{3,290}", text) or "." not in text:
        raise ValueError("Enter a web address that starts with https://")
    return text
