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
