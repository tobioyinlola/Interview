"""Turning what a job source reported into one clean posting, and recognising a listing that was
already seen on another board."""

import hashlib
import re
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.autoapply.adapters import RawPosting
from app.models import JobAlias, JobPosting

ARRANGEMENT_WORDS = {
    "remote": "remote",
    "work from home": "remote",
    "fully remote": "remote",
    "hybrid": "hybrid",
    "on-site": "onsite",
    "onsite": "onsite",
    "on site": "onsite",
    "in office": "onsite",
}
CONTRACT_WORDS = {
    "full time": "full_time",
    "full-time": "full_time",
    "permanent": "full_time",
    "part time": "part_time",
    "part-time": "part_time",
    "contract": "contract",
    "contractor": "contract",
    "freelance": "contract",
    "intern": "internship",
    "internship": "internship",
}
SENIORITY_WORDS = (  # first match wins, most senior words first
    ("executive", ("chief", "vp ", "vice president", "head of", "director")),
    ("lead", ("lead", "principal", "staff ", "group ")),
    ("senior", ("senior", "sr.", "sr ")),
    ("junior", ("junior", "jr.", "jr ", "associate", "entry level", "graduate")),
    ("intern", ("intern",)),
)
TRACKING = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gh_src",
    "ref",
    "source",
    "src",
    "lever-source",
}
GLOBAL_REGION = ("worldwide", "anywhere", "global", "any location", "all countries")


def slug(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def clean_url(url: str | None) -> str | None:
    """A canonical form of an address: lower-case host, no fragment, no tracking tags, no trailing
    slash, so the same page reached two ways compares equal."""
    if not url:
        return None
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    query = urlencode(
        sorted((k, v) for k, v in parse_qsl(parts.query) if k.lower() not in TRACKING)
    )
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme, parts.netloc.lower(), path, query, ""))


def _word_map(text: str | None, table: dict[str, str]) -> str | None:
    low = (text or "").lower()
    for word, value in table.items():
        if word in low:
            return value
    return None


PERIOD_WORDS = {  # what feeds call a pay period -> the periods a salary floor is given in
    "hour": "hour", "hourly": "hour", "hr": "hour",
    "day": "day", "daily": "day",
    "week": "week", "weekly": "week",
    "month": "month", "monthly": "month",
    "year": "year", "yearly": "year", "annual": "year", "annually": "year", "yr": "year",
}  # fmt: skip
SENIORITY_LEVELS = {"executive", "lead", "senior", "mid", "junior", "intern"}
KEY_MAX = 400  # the canonical_key column


def _text(value: str | None) -> str:
    """Feed text as Postgres will store it: NUL characters are refused by the database."""
    return (value or "").replace("\x00", "")


def _aware(value: datetime | None) -> datetime | None:
    """A feed date without a timezone is taken as UTC; the columns hold aware timestamps."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def infer_seniority(title: str) -> str | None:
    low = f"{title.lower()} "
    for level, words in SENIORITY_WORDS:
        if any(w in low for w in words):
            return level
    return None


def canonical_key(raw: RawPosting) -> tuple[str, bool]:
    key, confident = _canonical_key(raw)
    if len(key) > KEY_MAX:  # keep it unique: a cut-off key could merge two different jobs
        key = f"{key[: KEY_MAX - 17]}#{hashlib.sha256(key.encode()).hexdigest()[:16]}"
    return key, confident


def _canonical_key(raw: RawPosting) -> tuple[str, bool]:
    """(key, confident). A requisition id is the best identity, then the employer's own
    application address; without either, a company-and-title guess that is flagged uncertain."""
    company = slug(raw.company)
    if raw.requisition_id and raw.requisition_id.strip():
        return f"req:{company}:{slug(raw.requisition_id)}", True
    url = clean_url(raw.application_url)
    if url:
        return f"url:{url}", True
    return f"title:{company}:{slug(raw.title)}:{slug(raw.region)}", False


def _clean(raw: RawPosting) -> RawPosting:
    """The same posting with every text field safe to store."""
    from dataclasses import fields, replace

    changes = {
        f.name: _text(getattr(raw, f.name))
        for f in fields(raw)
        if isinstance(getattr(raw, f.name), str) and "\x00" in getattr(raw, f.name)
    }
    return replace(raw, **changes) if changes else raw


def normalise(raw: RawPosting) -> dict[str, Any]:
    """The fields of a posting, cleaned and typed. What a source did not say stays None: a missing
    fact is 'unknown', never a guess."""
    raw = _clean(raw)
    text = f"{raw.title} {raw.description[:2000]}"
    arrangement = _word_map(raw.arrangement, ARRANGEMENT_WORDS) or _word_map(
        text, ARRANGEMENT_WORDS
    )
    contract = _word_map(raw.contract, CONTRACT_WORDS) or _word_map(text, CONTRACT_WORDS)
    sponsor = (raw.sponsorship or "").lower().replace(" ", "_") or None
    if sponsor not in (None, "offered", "not_offered"):
        sponsor = None
    low = raw.description.lower()
    if sponsor is None:
        if "visa sponsorship" in low or "will sponsor" in low or "we sponsor" in low:
            sponsor = "offered"
        if "no sponsorship" in low or "unable to sponsor" in low or "not sponsor" in low:
            sponsor = "not_offered"
    currency = (raw.salary_currency or "").upper() or None
    return {
        "company": raw.company.strip()[:160],
        "title": raw.title.strip()[:240],
        "requisition_id": (raw.requisition_id or "").strip()[:120] or None,
        "description": raw.description.strip()[:30_000],
        "region": (raw.region or "").strip()[:200] or None,
        "arrangement": arrangement,
        "contract": contract,
        "seniority": (
            raw.seniority if raw.seniority in SENIORITY_LEVELS else infer_seniority(raw.title)
        ),
        "industry": (raw.industry or "").strip()[:80] or None,
        "salary_min": raw.salary_min,
        "salary_max": raw.salary_max if raw.salary_max is not None else raw.salary_min,
        "salary_currency": currency if currency and len(currency) == 3 else None,
        "salary_period": PERIOD_WORDS.get((raw.salary_period or "").lower().strip()),
        "sponsorship": sponsor,
        "posted_at": _aware(raw.posted_at),
        "expires_at": _aware(raw.expires_at),
        "application_url": clean_url(raw.application_url),
        "apply_email": (raw.apply_email or "").strip().lower()[:320] or None,
        "apply_instructions": raw.apply_instructions.strip()[:2000],
        "hiring_contact": (raw.hiring_contact or "").strip().lower()[:320] or None,
        "questions": raw.questions[:40],
        "evidence": dict(list(raw.evidence.items())[:30]),
    }


async def upsert(
    db: AsyncSession, raw: RawPosting, now: datetime
) -> tuple[JobPosting, bool, uuid.UUID | None]:
    """Store a sighting. Returns (posting, created, possible_duplicate_of).

    One posting per canonical key, however many boards list it or however many runs see it. A
    listing with no requisition id and no employer address is matched on company and title only,
    which is a guess, so a second one like it is kept separate and flagged for review instead."""
    key, confident = canonical_key(raw)
    fields = normalise(raw)
    alias = (
        await db.execute(select(JobAlias).where(JobAlias.source_url == raw.source_url))
    ).scalar_one_or_none()
    posting: JobPosting | None = None
    if alias is not None:
        posting = await db.get(JobPosting, alias.posting_id)
    created = False
    if posting is None:
        res = await db.execute(
            pg_insert(JobPosting)
            .values(
                id=uuid.uuid4(),
                canonical_key=key,
                source=raw.source,
                last_seen_at=now,
                created_at=now,
                **fields,
            )
            .on_conflict_do_nothing(index_elements=["canonical_key"])
            .returning(JobPosting.id)
        )
        created = res.scalar_one_or_none() is not None
        posting = (
            await db.execute(select(JobPosting).where(JobPosting.canonical_key == key))
        ).scalar_one()
    if not created:
        posting.last_seen_at = now
        # a later sighting can fill in what an earlier one lacked, never overwrite what it had
        for name, value in fields.items():
            if value not in (None, "", [], {}) and getattr(posting, name) in (None, "", [], {}):
                setattr(posting, name, value)
    seen = (
        await db.execute(select(JobAlias).where(JobAlias.source_url == raw.source_url))
    ).scalar_one_or_none()
    if seen is None:
        db.add(
            JobAlias(
                posting_id=posting.id, source=raw.source, source_url=raw.source_url, seen_at=now
            )
        )
    else:
        seen.seen_at = now
    dup: uuid.UUID | None = None
    if created:
        # Two openings with different requisition ids are different jobs, however alike they look.
        # It is only a possible duplicate when one side has no firm identity to tell them apart.
        others = (
            await db.execute(
                select(JobPosting.id, JobPosting.canonical_key).where(
                    func.lower(JobPosting.company) == fields["company"].lower(),
                    func.lower(JobPosting.title) == fields["title"].lower(),
                    func.lower(func.coalesce(JobPosting.region, ""))
                    == (fields["region"] or "").lower(),
                    JobPosting.id != posting.id,
                )
            )
        ).all()
        for other_id, other_key in others:
            if not confident or other_key.startswith("title:"):
                dup = other_id
                break
    await db.flush()
    return posting, created, dup


def is_expired(posting: JobPosting, now: datetime) -> bool:
    return posting.expires_at is not None and posting.expires_at <= now.astimezone(UTC)
