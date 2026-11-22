"""Time for Auto-Apply. Every rule that depends on the date takes `now` as an argument, so a test
can run a whole 30-day campaign with a clock it controls."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

CAMPAIGN_DAYS = 30


def utcnow() -> datetime:
    return datetime.now(UTC)


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        raise ValueError(f"unknown timezone: {name}") from None


def valid_timezone(name: str) -> bool:
    try:
        zone(name)
    except ValueError:
        return False
    return True


def local_day(now: datetime, tz: str) -> date:
    """The calendar day it is for the candidate right now."""
    return now.astimezone(zone(tz)).date()


def start_of_day(day: date, tz: str) -> datetime:
    """The instant a local day begins (handles daylight saving: a day can be 23 or 25 hours)."""
    return datetime.combine(day, time(0, 0), tzinfo=zone(tz)).astimezone(UTC)


def campaign_end(activated_at: datetime, tz: str) -> datetime:
    """Day 1 is the activation date; outbound work closes at the start of day 31."""
    first = local_day(activated_at, tz)
    return start_of_day(first + timedelta(days=CAMPAIGN_DAYS), tz)


def campaign_day(activated_at: datetime, now: datetime, tz: str) -> int:
    """1 on the activation date, 30 on the last working day, 31 and more once it has closed."""
    return (local_day(now, tz) - local_day(activated_at, tz)).days + 1


def within_active_hours(now: datetime, tz: str, hours: dict[str, int] | None) -> bool:
    """True when `hours` is unset, or the candidate's local hour falls in [start, end)."""
    if not hours or "start" not in hours or "end" not in hours:
        return True
    hour = now.astimezone(zone(tz)).hour
    start, end = int(hours["start"]), int(hours["end"])
    return start <= hour < end if start < end else (hour >= start or hour < end)
