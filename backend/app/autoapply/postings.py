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


_EMAIL = re.compile(r"[a-z0-9._%+\-]{1,64}@[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}", re.IGNORECASE)
# the listing is telling people to apply by email: a word of that kind in the same sentence
_APPLY_CUE = re.compile(
    r"\b(?:apply|applications?|applying|send|sent|submit|forward|email|e-mail|mail|resume|resum[eé]|"
    r"cv|cover letter|interested candidates|candidates|reach out)\b",
    re.IGNORECASE,
)
# addresses that are never an application address, and sites that are not the employer's
_NOT_APPLY_LOCAL = re.compile(
    r"^(?:no-?reply|do-?not-?reply|donotreply|support|help|privacy|legal|abuse|security|press|media|"
    r"billing|accounts?|sales|marketing|webmaster|postmaster|unsubscribe|bounce|mailer-daemon)$",
    re.IGNORECASE,
)
_NOT_APPLY_DOMAIN = re.compile(
    r"(?:^|\.)(?:example\.(?:com|org|net)|sentry\.io|wixpress\.com|googlegroups\.com)$",
    re.IGNORECASE,
)


MAX_APPLY_EMAILS = 3


def extract_apply_emails(description: str) -> list[tuple[str, str]]:
    """Every (address, the sentence that says so) the listing's own text gives for applying by
    email. Only an address in a sentence about applying counts, so a contact address for something
    else is never taken for one, and the sentence is kept as the evidence. When the listing names
    several application addresses they are all returned (up to three): the application goes to
    each."""
    found: dict[str, str] = {}
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", description or ""):
        if "@" not in sentence or not _APPLY_CUE.search(sentence):
            continue
        for m in _EMAIL.finditer(sentence):
            addr = m.group(0).lower().rstrip(".")
            local, _, domain = addr.partition("@")
            if _NOT_APPLY_LOCAL.match(local) or _NOT_APPLY_DOMAIN.search(domain):
                continue
            found.setdefault(addr, " ".join(sentence.split())[:240])
    return list(found.items())[:MAX_APPLY_EMAILS]


def extract_apply_email(description: str) -> tuple[str, str] | None:
    """The first of them, or None."""
    found = extract_apply_emails(description)
    return found[0] if found else None


def apply_addresses(posting: JobPosting) -> list[str]:
    """Where an application by email goes: the address the listing gave, and any others it gave."""
    if not posting.apply_email:
        return []
    more = [
        a.strip().lower()
        for a in str((posting.evidence or {}).get("apply_email_also", "")).split(",")
        if a.strip()
    ]
    return list(dict.fromkeys([posting.apply_email, *more]))[:MAX_APPLY_EMAILS]


def apply_to(posting: JobPosting) -> str | None:
    """The same as one 'To' value: 'a@x.io, b@y.io'."""
    return ", ".join(apply_addresses(posting)) or None


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
    apply_email = (raw.apply_email or "").strip().lower()[:320] or None
    evidence = dict(list(raw.evidence.items())[:30])
    if apply_email is None:
        said = extract_apply_emails(raw.description)
        if said:
            apply_email, evidence["apply_email"] = said[0][0][:320], said[0][1]
            if len(said) > 1:  # the others it gave: each gets the application too
                evidence["apply_email_also"] = ", ".join(a for a, _ in said[1:])
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
        "apply_email": apply_email,
        "apply_instructions": raw.apply_instructions.strip()[:2000],
        "hiring_contact": (raw.hiring_contact or "").strip().lower()[:320] or None,
        "questions": raw.questions[:40],
        "evidence": evidence,
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
            if name == "evidence":
                kept = dict(posting.evidence or {})
                new = {k: v for k, v in value.items() if k not in kept}
                # the sentence that justifies an address is only kept with that same address
                if "apply_email" in new and posting.apply_email != fields["apply_email"]:
                    new.pop("apply_email")
                    new.pop("apply_email_also", None)
                if new:
                    posting.evidence = {**kept, **new}
                continue
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


async def backfill_apply_emails(db: AsyncSession, limit: int = 500) -> int:
    """Postings stored before the listing's own "apply by email" sentences were read: look again, a
    batch at a time (called by the worker's housekeeping). Returns how many gained an address."""
    rows = (
        (
            await db.execute(
                select(JobPosting)
                .where(
                    JobPosting.apply_email.is_(None),
                    JobPosting.description.contains("@"),
                    JobPosting.expires_at.is_(None),
                )
                .order_by(JobPosting.last_seen_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    gained = 0
    for posting in rows:
        said = extract_apply_emails(posting.description)
        if not said or "apply_email" in (posting.evidence or {}):
            continue
        posting.apply_email = said[0][0][:320]
        extra = {"apply_email": said[0][1]}
        if len(said) > 1:
            extra["apply_email_also"] = ", ".join(a for a, _ in said[1:])
        posting.evidence = {**(posting.evidence or {}), **extra}
        gained += 1
    if gained:
        await db.commit()
    return gained
