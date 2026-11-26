"""Usage statistics from the app: what is accepted, how it is checked, and how long it is kept.

The rule that shapes everything here: an event can carry NO words. A name from a fixed list, a
route with ids removed, and a few short coded values or numbers. Nothing a person typed, said,
uploaded or was shown can be sent, because the server refuses anything else. That is what lets the
back office read engagement without reading anyone's content, on every device the app runs on."""

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import ClientEvent

log = logging.getLogger("app.analytics")

PLATFORMS = ("web", "windows", "macos", "linux", "android", "ios")
FORM_FACTORS = ("phone", "tablet", "desktop")
VIEWPORTS = ("xs", "sm", "md", "lg", "xl")

# name -> what it means. The data dictionary in docs/analytics.md is generated from reading this.
EVENT_NAMES: dict[str, str] = {
    "app_open": "The app was opened (props: source = cold | resume)",
    "app_foreground": "The app came to the front",
    "app_background": "The app went away; seconds = active time since it came to the front",
    "screen_view": "A screen was opened (route, ids removed)",
    "screen_engaged": "A screen was left; seconds = time the person was really there",
    "interaction": "A marked control was used (ev = its code name)",
    "feature_used": "A feature was used (feature, optional detail)",
    "step_view": "A step of a guided flow was shown (feature = the flow, step)",
    "ui_error": "The interface failed (kind = the error's type name, source)",
    "app_loaded": "How long the first screen took (ms)",
    "connectivity": "The device went offline or came back (state)",
}
PROP_KEYS = frozenset(
    {"source", "seconds", "ev", "feature", "detail", "step", "kind", "ms", "state", "mode", "tab"}
)
NUMBER_KEYS = frozenset({"seconds", "ms"})
MAX_NUMBER = {"seconds": 4 * 3600, "ms": 10 * 60 * 1000}
SLUG = re.compile(r"^[a-z0-9][a-z0-9_.:\-]{0,39}$")
ROUTE = re.compile(r"^/[a-z0-9/_:\-]{0,78}$")
ID_SEGMENT = re.compile(r"^(?:[0-9a-f]{8}-[0-9a-f-]{27}|[0-9]{3,}|[0-9a-f]{16,}|[a-z0-9_\-]{24,})$")
ANON_ID = re.compile(r"^[0-9a-f\-]{8,36}$")
MAX_PER_BATCH = 50
MAX_PROPS = 8


def clean_route(raw: str | None) -> str | None:
    """A route as a pattern: ids and long tokens become ':id'. None when it is not a plain path."""
    if raw is None:
        return None
    raw = raw.strip().lower().split("?")[0].split("#")[0]
    if len(raw) > 1:
        raw = raw.rstrip("/")
    if not ROUTE.match(raw):
        return None
    parts = [":id" if ID_SEGMENT.match(p) else p for p in raw.split("/")]
    return "/".join(parts)[:80] or "/"


def clean_props(raw: dict[str, Any]) -> dict[str, Any]:
    """Only the allowed keys, with numbers within range and codes in the plain-word shape."""
    out: dict[str, Any] = {}
    for key, value in raw.items():
        if key not in PROP_KEYS or len(out) >= MAX_PROPS:
            continue
        if key in NUMBER_KEYS:
            if isinstance(value, bool) or not isinstance(value, int | float):
                continue
            out[key] = int(max(0, min(MAX_NUMBER[key], value)))
        elif isinstance(value, str) and SLUG.match(value):
            out[key] = value
    return out


@dataclass(frozen=True)
class Context:
    device_id: str
    session_id: str
    platform: str
    form_factor: str
    app_version: str
    locale: str
    viewport: str


def clean_context(
    *, device_id: str, session_id: str, platform: str, form_factor: str,
    app_version: str, locale: str, viewport: str,
) -> Context | None:  # fmt: skip
    """The device the batch came from, or None when it does not look like our app."""
    if not (ANON_ID.match(device_id) and ANON_ID.match(session_id)):
        return None
    if platform not in PLATFORMS or form_factor not in FORM_FACTORS:
        return None
    return Context(
        device_id=device_id,
        session_id=session_id,
        platform=platform,
        form_factor=form_factor,
        app_version=re.sub(r"[^0-9a-zA-Z.\-+]", "", app_version)[:20],
        locale=re.sub(r"[^a-zA-Z\-]", "", locale)[:12],
        viewport=viewport if viewport in VIEWPORTS else "",
    )


def when(ms: int | None, now: datetime) -> datetime:
    """The event's own time, unless it is from the far past or the future (a wrong clock)."""
    if ms is None:
        return now
    try:
        t = datetime.fromtimestamp(ms / 1000, UTC)
    except (OverflowError, OSError, ValueError):
        return now
    return t if now - timedelta(hours=24) <= t <= now + timedelta(minutes=5) else now


async def ingest(
    db: AsyncSession,
    ctx: Context,
    user_id: uuid.UUID | None,
    events: list[dict[str, Any]],
    now: datetime,
) -> tuple[int, int]:
    """Store what passes the checks. Returns (accepted, rejected). Commits."""
    rows: list[ClientEvent] = []
    for e in events[:MAX_PER_BATCH]:
        name = str(e.get("name", ""))
        if name not in EVENT_NAMES:
            continue
        route = clean_route(e.get("route")) if e.get("route") is not None else None
        if e.get("route") is not None and route is None:
            continue
        props = clean_props(e.get("props") or {})
        rows.append(
            ClientEvent(
                id=uuid.uuid4(),
                ts=when(e.get("ts"), now),
                received_at=now,
                device_id=ctx.device_id,
                session_id=ctx.session_id,
                user_id=user_id,
                name=name,
                route=route,
                props=props,
                platform=ctx.platform,
                form_factor=ctx.form_factor,
                app_version=ctx.app_version,
                locale=ctx.locale,
                viewport=ctx.viewport,
            )
        )
    if rows:
        db.add_all(rows)
        await db.commit()
    return len(rows), min(len(events), MAX_PER_BATCH) - len(rows)


async def forget_user(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Delete everything collected about one person (they turned statistics off)."""
    res = await db.execute(delete(ClientEvent).where(ClientEvent.user_id == user_id))
    return int(res.rowcount or 0)  # type: ignore[attr-defined]


async def purge_old_client_events(sf: async_sessionmaker[AsyncSession], days: int) -> int:
    """Statistics are for running the product, not an archive."""
    try:
        async with sf() as db:
            res = await db.execute(
                delete(ClientEvent).where(ClientEvent.ts < datetime.now(UTC) - timedelta(days=days))
            )
            await db.commit()
            return int(res.rowcount or 0)  # type: ignore[attr-defined]
    except Exception as exc:
        log.warning("analytics purge failed", extra={"fields": {"error": type(exc).__name__}})
        return 0
