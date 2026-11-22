"""Does a posting fit what the candidate asked for?

Each criterion is judged pass, fail or unknown, with the evidence it was judged on. A required
criterion that fails means skip; one that is unknown means a person must look (never a guess);
only when every required criterion passes may an application go out on its own. Preferences only
change the ranking."""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.autoapply.postings import GLOBAL_REGION, is_expired
from app.models import JobPosting

PASS, FAIL, UNKNOWN = "pass", "fail", "unknown"

# Only what is needed to know that "Nigeria" is inside "Africa"; anything else is "unknown".
CONTINENT = {
    "africa": (
        "nigeria ghana kenya south africa egypt ethiopia tanzania uganda rwanda senegal morocco"
    ).split(),
    "europe": (
        "united kingdom uk ireland germany france spain portugal italy netherlands poland sweden"
    ).split(),
    "north america": "united states usa us canada mexico".split(),
    "asia": "india singapore japan philippines indonesia pakistan bangladesh vietnam".split(),
}
COUNTRY_ALIASES = {"uk": "united kingdom", "usa": "united states", "us": "united states"}
STOP = {"the", "and", "of", "a", "an", "for", "in", "at", "to", "senior", "junior", "lead"}


def words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9+#]+", text.lower()) if w not in STOP]


def _place(text: str) -> set[str]:
    """The countries and regions a text names, with the continents that contain them."""
    low = " " + re.sub(r"[^a-z ]+", " ", text.lower()) + " "
    found = {c for c in _all_places() if f" {c} " in low}
    for cont, countries in CONTINENT.items():
        if cont in found:
            found |= set(countries)
        if found & set(countries):
            found.add(cont)
    return {COUNTRY_ALIASES.get(f, f) for f in found}


def _all_places() -> set[str]:
    places = set(CONTINENT) | set(COUNTRY_ALIASES)
    for countries in CONTINENT.values():
        places |= set(countries)
    return places


@dataclass
class Rule:
    key: str
    label: str
    required: bool
    status: str
    evidence: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "required": self.required,
            "status": self.status,
            "evidence": self.evidence,
        }


@dataclass
class Match:
    decision: str  # eligible | review | skip
    rules: list[Rule] = field(default_factory=list)
    score: float = 0.0
    reason: str = ""  # why skipped or why a person must look

    def as_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision,
            "score": round(self.score, 3),
            "reason": self.reason,
            "rules": [r.as_dict() for r in self.rules],
        }


def _any_of(items: list[dict[str, Any]], judge: Any) -> tuple[str, str, bool]:
    """Judge a list of acceptable values. Passing any one of them is enough. (status, evidence,
    required) where required means every entry is a hard rule."""
    results = [(judge(i["value"]), i["value"]) for i in items]
    required = any(i.get("required") for i in items)
    for (status, ev), _value in results:
        if status == PASS:
            return PASS, ev, required
    if any(s == UNKNOWN for (s, _), _v in results):
        return UNKNOWN, next(ev for (s, ev), _v in results if s == UNKNOWN), required
    return FAIL, results[0][0][1], required


def _role(posting: JobPosting) -> Any:
    title = set(words(posting.title))

    def judge(target: str) -> tuple[str, str]:
        want = words(target)
        if not want:
            return UNKNOWN, "no role words to compare"
        share = sum(w in title for w in want) / len(want)
        if share >= 0.75:
            return PASS, f"'{posting.title}' matches '{target}'"
        if share < 0.34:
            return FAIL, f"'{posting.title}' does not look like '{target}'"
        return UNKNOWN, f"'{posting.title}' only partly matches '{target}'"

    return judge


def _where(posting: JobPosting) -> Any:
    def judge(target: str) -> tuple[str, str]:
        region = posting.region
        if not region:
            why = (
                "remote, but the listing does not say who may apply"
                if posting.arrangement == "remote"
                else "the listing does not say where the role is"
            )
            return UNKNOWN, why
        low = region.lower()
        if any(g in low for g in GLOBAL_REGION):
            return PASS, f"open to candidates anywhere ('{region}')"
        want, have = _place(target), _place(region)
        if not have:
            return UNKNOWN, f"'{region}' could not be compared with '{target}'"
        if want & have or target.lower() in low:
            return PASS, f"'{region}' includes '{target}'"
        return FAIL, f"the role is for '{region}', not '{target}'"

    return judge


def _same(actual: str | None, label: str) -> Any:
    def judge(target: str) -> tuple[str, str]:
        if actual is None:
            return UNKNOWN, f"the listing does not state the {label}"
        if actual == target:
            return PASS, f"{label}: {actual.replace('_', ' ')}"
        return FAIL, f"{label} is {actual.replace('_', ' ')}, not {target.replace('_', ' ')}"

    return judge


def _industry(posting: JobPosting) -> Any:
    def judge(target: str) -> tuple[str, str]:
        if not posting.industry:
            return UNKNOWN, "the listing does not state the industry"
        if target.lower() in posting.industry.lower() or posting.industry.lower() in target.lower():
            return PASS, f"industry: {posting.industry}"
        return FAIL, f"industry is {posting.industry}"

    return judge


def _salary(floor: dict[str, Any], posting: JobPosting) -> tuple[str, str]:
    """Compared only when the currency and the pay period are the same; otherwise unknown."""
    top = posting.salary_max if posting.salary_max is not None else posting.salary_min
    if top is None:
        return UNKNOWN, "the listing does not state the pay"
    if posting.salary_currency != floor["currency"] or posting.salary_period != floor["period"]:
        return UNKNOWN, (
            f"the listing pays in {posting.salary_currency or '?'} per "
            f"{posting.salary_period or '?'}, and your floor is {floor['currency']} per "
            f"{floor['period']}, so they cannot be compared"
        )
    if top >= floor["floor"]:
        return (
            PASS,
            f"up to {top:g} {floor['currency']} per {floor['period']} (floor {floor['floor']:g})",
        )
    return (
        FAIL,
        f"pays at most {top:g} {floor['currency']} per {floor['period']}, "
        f"below your floor of {floor['floor']:g}",
    )


def _sponsorship(need: dict[str, Any], posting: JobPosting) -> tuple[str, str]:
    if need["need"] == "not_needed":
        return PASS, "you do not need sponsorship"
    if posting.sponsorship == "offered":
        return PASS, "the listing offers visa sponsorship"
    if posting.sponsorship == "not_offered":
        return FAIL, "the listing says it does not sponsor visas"
    return UNKNOWN, "the listing does not say whether it sponsors visas"


def evaluate(
    criteria: dict[str, Any],
    posting: JobPosting,
    *,
    now: datetime,
    routes: set[str],
    channels: dict[str, bool],
    overrides: set[str] | None = None,
) -> Match:
    """Judge every criterion. `routes` is how this posting can be applied to (form, email);
    `overrides` are rules the candidate has looked at and approved by hand."""
    overrides = overrides or set()
    rules: list[Rule] = []

    def add(key: str, label: str, status: str, evidence: str, required: bool) -> None:
        if status == UNKNOWN and key in overrides:
            status, evidence = PASS, f"you confirmed this yourself ({evidence})"
        rules.append(Rule(key, label, required, status, evidence))

    if is_expired(posting, now):
        return Match(
            "skip",
            [Rule("open", "Still open", True, FAIL, "the listing has expired")],
            reason="The listing has expired.",
        )
    add("open", "Still open", PASS, "no expiry date has passed", True)

    for key, label, judge_for in (
        ("role", "Target role", _role(posting)),
        ("location", "Location or region", _where(posting)),
        ("arrangement", "Work arrangement", _same(posting.arrangement, "work arrangement")),
        ("seniority", "Seniority", _same(posting.seniority, "seniority")),
        ("contract", "Contract type", _same(posting.contract, "contract type")),
        ("industry", "Industry", _industry(posting)),
    ):
        source = "locations" if key == "location" else key if key != "role" else "roles"
        items = criteria.get(source) or []
        if items:
            status, evidence, required = _any_of(items, judge_for)
            add(key, label, status, evidence, required)
    if criteria.get("salary"):
        status, evidence = _salary(criteria["salary"], posting)
        add("salary", "Salary", status, evidence, bool(criteria["salary"].get("required")))
    if criteria.get("sponsorship"):
        status, evidence = _sponsorship(criteria["sponsorship"], posting)
        add(
            "sponsorship",
            "Visa sponsorship",
            status,
            evidence,
            bool(criteria["sponsorship"].get("required")),
        )

    usable = {r for r in routes if channels.get(r)}
    if usable:
        add("channel", "A way to apply", PASS, f"can apply by {' or '.join(sorted(usable))}", True)
    elif routes:
        add(
            "channel",
            "A way to apply",
            FAIL,
            f"the listing accepts {' or '.join(sorted(routes))}, which you switched off",
            True,
        )
    else:
        add(
            "channel",
            "A way to apply",
            FAIL,
            "no supported way to apply was found on the listing",
            True,
        )

    failed = [r for r in rules if r.required and r.status == FAIL]
    unknown = [r for r in rules if r.required and r.status == UNKNOWN]
    score = sum(
        (1.0 if r.status == PASS else -1.0 if r.status == FAIL else 0.0)
        * (1.0 if not r.required else 0.25)
        for r in rules
        if r.key not in ("open", "channel")
    )
    if failed:
        return Match(
            "skip",
            rules,
            score,
            reason=failed[0].evidence[0].upper() + failed[0].evidence[1:] + ".",
        )
    if unknown:
        return Match(
            "review",
            rules,
            score,
            reason=unknown[0].evidence[0].upper() + unknown[0].evidence[1:] + ".",
        )
    return Match("eligible", rules, score)
