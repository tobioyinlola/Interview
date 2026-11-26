"""How well a job fits the person, as a weighted score from 0 to 100, worked out with plain rules
from their confirmed CV facts and their search: no model call. It runs only on jobs that already
passed every hard requirement (eligibility comes first; a failed requirement is never outweighed).

Factors and default weights (AUTOAPPLY_FIT_WEIGHTS):
  skills 30, experience 25, role 20, industry 10, seniority 10, preferences 5.
A factor the listing gives nothing to judge on counts as half, and says so; it is never a guess
either way. Thresholds (AUTOAPPLY_FIT_AUTO, AUTOAPPLY_FIT_REVIEW): at or above the first the
application is prepared; between them the person decides; below the second it is skipped."""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.autoapply import matching
from app.autoapply.postings import infer_seniority
from app.models import JobPosting

DEFAULT_WEIGHTS = {
    "skills": 30, "experience": 25, "role": 20, "industry": 10, "seniority": 10, "preferences": 5,
}  # fmt: skip
LEVELS = ["intern", "junior", "mid", "senior", "lead", "principal", "director", "executive"]
_YEARS = re.compile(r"(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?", re.IGNORECASE)


@dataclass
class Factor:
    key: str
    weight: int
    value: float  # 0..1
    known: bool
    why: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "weight": self.weight,
            "value": round(self.value, 2),
            "known": self.known,
            "why": self.why,
        }


@dataclass
class Fit:
    score: float  # 0..100
    factors: list[Factor] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"score": round(self.score, 1), "factors": [f.as_dict() for f in self.factors]}


def weights(setting: str) -> dict[str, int]:
    out = dict(DEFAULT_WEIGHTS)
    for part in setting.split(","):
        k, _, v = part.partition("=")
        if k.strip() in out and v.strip().isdigit():
            out[k.strip()] = int(v)
    return out


def _has(term: str, text: str) -> bool:
    return bool(re.search(rf"(?<![\w]){re.escape(term.lower())}(?![\w])", text))


def _skills(facts: dict[str, Any], text: str) -> tuple[float, bool, str]:
    skills = [s for s in (facts.get("skills") or []) if str(s).strip()]
    if not skills or len(text) < 80:
        return 0.5, False, "the listing or the CV says too little about skills"
    hits = [s for s in skills if _has(str(s), text)]
    # a listing names a handful of skills; matching three of the candidate's is a strong overlap
    value = min(1.0, len(hits) / min(3, len(skills)))
    return (
        value,
        True,
        (f"mentions {', '.join(hits[:4])}" if hits else "none of your listed skills is mentioned"),
    )


def _years(history: list[dict[str, Any]], now: datetime) -> float:
    total = 0.0
    for h in history:
        start = re.search(r"(19|20)\d{2}", str(h.get("start", "")))
        end = re.search(r"(19|20)\d{2}", str(h.get("end", "")))
        if start:
            last = int(end.group()) if end else now.year
            total += max(0, last - int(start.group()))
    return total


def _experience(
    facts: dict[str, Any], posting: JobPosting, now: datetime
) -> tuple[float, bool, str]:
    history = facts.get("history") or []
    have = _years(history, now)
    asked = [int(m.group(1)) for m in _YEARS.finditer(posting.description or "")]
    need = min(asked) if asked else None
    if need is not None and need > 0:
        if have == 0:
            return 0.5, False, f"asks for {need} years; your CV dates are unclear"
        return min(1.0, have / need), True, f"asks for {need} years; you have about {have:.0f}"
    related = [
        h for h in history
        if matching.role_fit(posting.title, str(h.get("title", "")))[0] == matching.PASS
        or matching.role_fit(str(h.get("title", "")), posting.title)[0] == matching.PASS
    ]  # fmt: skip
    if related:
        return 1.0, True, f"you have done this role ({related[0].get('title')})"
    return 0.5, False, "no years asked for, and no past role with this title"


def _role(criteria: dict[str, Any], facts: dict[str, Any], title: str) -> tuple[float, bool, str]:
    wanted = [r["value"] for r in (criteria.get("roles") or [])]
    if not wanted:
        latest = (facts.get("history") or [{}])[0].get("title") or ""
        wanted = [latest] if latest else []
    best, why = 0.0, "not one of the roles you chose"
    for target in wanted:
        status, ev = matching.role_fit(title, target)
        v = {matching.PASS: 1.0, matching.UNKNOWN: 0.5}.get(status, 0.0)
        if v > best:
            best, why = v, ev
    return (best, True, why) if wanted else (0.5, False, "no role chosen to compare with")


def _industry(criteria: dict[str, Any], posting: JobPosting) -> tuple[float, bool, str]:
    wanted = [i["value"].lower() for i in (criteria.get("industries") or [])]
    if not wanted:
        return 0.5, False, "you chose no industry"
    text = f"{posting.industry or ''} {posting.description or ''}".lower()
    hit = next((w for w in wanted if w in text), None)
    if hit:
        return 1.0, True, f"in {hit}"
    if not posting.industry:
        return 0.5, False, "the listing does not say its industry"
    return 0.0, True, f"in {posting.industry}, not an industry you chose"


def _level(title: str | None) -> int | None:
    s = infer_seniority(title or "") if title else None
    return LEVELS.index(s) if s in LEVELS else None


def _seniority(facts: dict[str, Any], posting: JobPosting) -> tuple[float, bool, str]:
    job = _level(posting.seniority) if posting.seniority in LEVELS else _level(posting.title)
    if posting.seniority in LEVELS:
        job = LEVELS.index(posting.seniority)
    latest = (facts.get("history") or [{}])[0].get("title")
    mine = _level(latest) if latest else None
    if job is None or mine is None:
        return 0.5, False, "the level is not clear from the titles"
    gap = abs(job - mine)
    return (
        max(0.0, 1 - 0.4 * gap),
        True,
        (
            "the same level as your latest role"
            if gap == 0
            else f"{gap} level(s) from your latest role"
        ),
    )


def _preferences(match: matching.Match) -> tuple[float, bool, str]:
    soft = [r for r in match.rules if not r.required and r.stated]
    if not soft:
        return 0.5, False, "no preferences the listing speaks to"
    ok = [r for r in soft if r.status == matching.PASS]
    return len(ok) / len(soft), True, f"{len(ok)} of {len(soft)} of your preferences met"


def score(
    criteria: dict[str, Any],
    facts: dict[str, Any],
    posting: JobPosting,
    match: matching.Match,
    now: datetime,
    weight_setting: str = "",
) -> Fit:
    w = weights(weight_setting)
    text = f"{posting.title} {posting.description or ''}".lower()
    parts = {
        "skills": _skills(facts, text),
        "experience": _experience(facts, posting, now),
        "role": _role(criteria, facts, posting.title),
        "industry": _industry(criteria, posting),
        "seniority": _seniority(facts, posting),
        "preferences": _preferences(match),
    }
    factors = [Factor(k, w[k], v, known, why) for k, (v, known, why) in parts.items()]
    total = sum(f.weight for f in factors) or 1
    return Fit(100 * sum(f.weight * f.value for f in factors) / total, factors)
