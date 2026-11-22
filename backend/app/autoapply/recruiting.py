"""Reading an employer's message: what kind it is, what times and links it holds.

Everything here is a plain function of text. A message can only ever supply evidence (a kind, a
time, a link to show): it cannot ask for a send, change a recipient, ask for credentials or call
anything, because nothing in this module has the means to."""

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from urllib.parse import urlsplit

from app.autoapply.postings import clean_url

MONTHS = {
    m: i
    for i, names in enumerate(
        [
            ("january", "jan"),
            ("february", "feb"),
            ("march", "mar"),
            ("april", "apr"),
            ("may",),
            ("june", "jun"),
            ("july", "jul"),
            ("august", "aug"),
            ("september", "sept", "sep"),
            ("october", "oct"),
            ("november", "nov"),
            ("december", "dec"),
        ],
        1,
    )
    for m in names
}
# Time-zone names that mean one thing. Others (IST, CST, BST) mean different offsets in different
# countries, so a time given in them is never assumed: the candidate is asked.
ZONES = {
    "utc": 0, "gmt": 0, "z": 0, "wat": 1, "cat": 2, "eat": 3, "sast": 2, "cet": 1, "cest": 2,
    "eet": 2, "eest": 3, "est": -5, "edt": -4, "pst": -8, "pdt": -7, "mst": -7, "mdt": -6,
    "jst": 9, "aest": 10, "aedt": 11,
}  # fmt: skip
AMBIGUOUS_ZONES = {"ist", "cst", "bst", "pst", "ast", "mst"} - set(ZONES)

PATTERNS: list[tuple[str, tuple[str, ...]]] = [
    (
        "rejection",
        (
            "unfortunately", "not moving forward", "will not be moving", "decided not to proceed",
            "decided to move forward with other", "regret to inform", "not be proceeding",
            "position has been filled",
        ),
    ),
    ("cancellation", ("cancel", "called off", "no longer able to meet")),
    ("reschedule", ("reschedul", "new time", "moved to", "change the time", "different time")),
    (
        "assessment",
        (
            "assessment", "coding test", "take-home", "take home", "hackerrank", "codility",
            "case study", "online test",
        ),
    ),
    (
        "invitation",
        (
            "schedule an interview", "schedule a call", "invite you to interview", "invite you for",
            "book a time", "pick a time", "calendly", "select a time", "your availability",
            "schedule your interview", "like to interview you",
        ),
    ),
    (
        "shortlist",
        ("shortlist", "short-list", "short list", "next stage", "next round", "move you forward",
         "progress to the next"),
    ),
    (
        "acknowledgment",
        ("received your application", "thank you for applying", "thanks for applying",
         "application received", "we have received", "we've received"),
    ),
]  # fmt: skip
CONFIRM_WORDS = ("confirm", "is scheduled", "scheduled for", "booked", "calendar invite", "see you")
SCHEDULING_HOSTS = ("calendly.com", "cal.com", "goodtime.io", "savvycal.com", "hirevue.com")
MEETING_HOSTS = ("meet.google.com", "zoom.us", "teams.microsoft.com", "webex.com", "whereby.com")
URL = re.compile(r"https?://[^\s<>\"')\]]+", re.I)
ORDINALS = {
    "first": 1,
    "1st": 1,
    "second": 2,
    "2nd": 2,
    "third": 3,
    "3rd": 3,
    "fourth": 4,
    "4th": 4,
}


@dataclass
class Schedule:
    when: datetime | None  # UTC; when the zone was unclear this assumes the candidate's own zone
    unclear: bool  # the message gave no usable time zone
    local: str | None  # the time exactly as written, "2026-12-03T14:00", for confirming later


def classify(subject: str, text: str) -> str | None:
    """The kind of recruiting message this is, or None when it is not one."""
    low = f"{subject}\n{text}".lower()
    kind = next((k for k, words in PATTERNS if any(w in low for w in words)), None)
    if kind in ("invitation", "shortlist", "assessment", None):
        if parse_schedule(f"{subject}\n{text}", "UTC").local and any(
            w in low for w in CONFIRM_WORDS
        ):
            if "interview" in low or "call" in low or "meeting" in low or "chat" in low:
                return "confirmation"
    return kind


def links(text: str) -> dict[str, str]:
    """The scheduling and meeting links in a message, cleaned. They are only ever shown to the
    candidate to open; nothing follows them."""
    out: dict[str, str] = {}
    for raw in URL.findall(text):
        url = clean_url(raw.rstrip(".,;"))
        if not url or len(url) > 500:
            continue
        host = (urlsplit(url).hostname or "").lower()
        if "meeting_url" not in out and any(
            host == h or host.endswith("." + h) for h in MEETING_HOSTS
        ):
            out["meeting_url"] = url
        elif "scheduling_url" not in out and any(
            host == h or host.endswith("." + h) for h in SCHEDULING_HOSTS
        ):
            out["scheduling_url"] = url
    return out


def round_of(text: str) -> int | None:
    low = text.lower()
    m = re.search(r"\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+(?:round|interview|stage)", low)
    if m:
        return ORDINALS[m.group(1)]
    m = re.search(r"\b(?:round|stage)\s+(\d)\b", low)
    return int(m.group(1)) if m else None


_TIME = r"(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?"
_ZONE = (
    r"(?:\s*\(?\s*((?:UTC|GMT)\s*[+-]\s*\d{1,2}(?::?\d{2})?|[+-]\d{2}:?\d{2}|[A-Za-z]{1,5})\)?)?"
)
ISO = re.compile(
    r"(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(Z|[+-]\d{2}:?\d{2}|[A-Za-z]{2,5})?",
    re.I,
)
MDY = re.compile(
    r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:\s+at|\s*,|\s+@)?\s+"
    + _TIME
    + _ZONE,
    re.I,
)
DMY = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?:\s+at|\s*,|\s+@)?\s+"
    + _TIME
    + _ZONE,
    re.I,
)


def _offset(token: str | None) -> tuple[timedelta | None, bool]:
    """(offset, usable). None with usable False means no zone was given or it is ambiguous."""
    if not token:
        return None, False
    t = token.strip().lower().replace(" ", "")
    if t in ZONES:
        return timedelta(hours=ZONES[t]), True
    m = re.fullmatch(r"(?:utc|gmt)?([+-])(\d{1,2})(?::?(\d{2}))?", t)
    if m:
        delta = timedelta(hours=int(m.group(2)), minutes=int(m.group(3) or 0))
        return (delta if m.group(1) == "+" else -delta), True
    return None, False


def _hour(h: str, m: str | None, ampm: str | None) -> tuple[int, int] | None:
    hour, minute = int(h), int(m or 0)
    if ampm:
        pm = ampm.lower().startswith("p")
        if not 1 <= hour <= 12:
            return None
        hour = (hour % 12) + (12 if pm else 0)
    return (hour, minute) if 0 <= hour <= 23 and 0 <= minute <= 59 else None


def parse_schedule(text: str, assumed_zone: str) -> Schedule:
    """The first date and time in `text`. When it names a clear time zone the result is exact.
    When it names none, or an ambiguous one such as IST, the time is read in `assumed_zone`
    and marked unclear so the candidate is asked to confirm it."""
    from app.autoapply.clock import zone

    found: tuple[int, int, int, int, int, str | None] | None = None
    if m := ISO.search(text):
        y, mo, d, h, mi, tz = m.groups()
        found = (int(y), int(mo), int(d), int(h), int(mi), tz)
    elif m := MDY.search(text):
        mon, d, y, h, mi, ap, tz = m.groups()
        if mon.lower() in MONTHS and (hm := _hour(h, mi, ap)):
            found = (int(y), MONTHS[mon.lower()], int(d), hm[0], hm[1], tz)
    elif m := DMY.search(text):
        d, mon, y, h, mi, ap, tz = m.groups()
        if mon.lower() in MONTHS and (hm := _hour(h, mi, ap)):
            found = (int(y), MONTHS[mon.lower()], int(d), hm[0], hm[1], tz)
    if found is None:
        return Schedule(None, False, None)
    y, mo, d, h, mi, tz = found
    try:
        naive = datetime(y, mo, d, h, mi)
    except ValueError:
        return Schedule(None, False, None)
    local = naive.isoformat(timespec="minutes")
    delta, usable = _offset(tz)
    if usable and delta is not None:
        return Schedule((naive - delta).replace(tzinfo=UTC), False, local)
    zoned = naive.replace(tzinfo=zone(assumed_zone)).astimezone(UTC)
    return Schedule(zoned, True, local)


def at_zone(local_iso: str, zone_name: str) -> datetime:
    """A written local time read in a zone the candidate has confirmed."""
    from app.autoapply.clock import zone

    return datetime.fromisoformat(local_iso).replace(tzinfo=zone(zone_name)).astimezone(UTC)


_ = timezone  # (kept for callers that compare with fixed offsets)
