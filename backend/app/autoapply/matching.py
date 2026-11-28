"""Does a posting fit what the candidate asked for?

Each criterion is judged pass, fail or unknown, with the evidence it was judged on. A required
criterion that fails means skip; one that is unknown means a person must look (never a guess);
only when every required criterion passes may an application go out on its own. Preferences only
change the ranking."""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from app.autoapply.postings import GLOBAL_REGION, is_expired
from app.models import JobPosting

PASS, FAIL, UNKNOWN = "pass", "fail", "unknown"
# The listing simply does not say (no pay, no place, no contract type). That is not held against it:
# the rule passes, but it does not count as evidence of a good fit.
ABSENT = "absent"

# Only what is needed to know that "Nigeria" is inside "Africa"; anything else is "unknown".
CONTINENT = {
    "africa": [
        "nigeria", "ghana", "kenya", "south africa", "egypt", "ethiopia", "tanzania", "uganda",
        "rwanda", "senegal", "morocco",
    ],
    "europe": [
        "united kingdom", "ireland", "germany", "france", "spain", "portugal", "italy",
        "netherlands", "poland", "sweden",
    ],
    "north america": ["united states", "canada", "mexico"],
    "asia": [
        "india", "singapore", "japan", "philippines", "indonesia", "pakistan", "bangladesh",
        "vietnam",
    ],
}  # fmt: skip
COUNTRY_ALIASES = {"uk": "united kingdom", "usa": "united states", "us": "united states"}
STOP = {"the", "and", "of", "a", "an", "for", "in", "at", "to", "senior", "junior", "lead"}
# Words that say "some kind of manager" and nothing about which: sharing only them is no match.
GENERIC = {
    "manager", "director", "head", "engineer", "analyst", "specialist", "associate", "officer",
    "executive", "coordinator", "consultant", "developer", "intern", "assistant", "partner",
}  # fmt: skip


def words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9+#]+", text.lower()) if w not in STOP]


def _named(text: str) -> set[str]:
    """The countries and regions a text names (no guessing about what else they contain)."""
    low = " " + re.sub(r"[^a-z ]+", " ", text.lower()) + " "
    found = set()
    for c in _all_places():
        if f" {c} " not in low:
            continue
        if c == "us" and not re.search(r"\bUS\b", text):
            continue  # "join us" is not a country
        found.add(COUNTRY_ALIASES.get(c, c))
    # "South Africa" is not also "Africa", and "Ireland" is not inside "Northern Ireland" twice
    return {p for p in found if not any(q != p and f" {p} " in f" {q} " for q in found)}


def _continent_of(place: str) -> str | None:
    for cont, countries in CONTINENT.items():
        if place in countries:
            return cont
    return None


def _covers(have: set[str], target: str) -> bool:
    """Does a listing that names the places `have` accept someone from `target`?

    A country is accepted by itself or by the continent that holds it. A continent is accepted by
    itself or by a country inside it. Two different countries on one continent do not match."""
    wanted = _named(target)
    for t in wanted or {target.lower()}:
        if t in have:
            return True
        cont = _continent_of(t)
        if cont and cont in have:
            return True
        if t in CONTINENT and any(c in have for c in CONTINENT[t]):
            return True
    return False


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
    stated: bool = True  # false: the listing did not say, so the rule passed by default

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "required": self.required,
            "status": self.status,
            "evidence": self.evidence,
            "stated": self.stated,
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
    required) where required means every entry is a hard rule. A listing that does not say is
    ABSENT for every value, which is not a failure."""
    results = [(judge(i["value"]), i["value"]) for i in items]
    required = any(i.get("required") for i in items)
    for (status, ev), _value in results:
        if status == PASS:
            return PASS, ev, required
    if any(s == UNKNOWN for (s, _), _v in results):
        return UNKNOWN, next(ev for (s, ev), _v in results if s == UNKNOWN), required
    if any(s == ABSENT for (s, _), _v in results):
        return ABSENT, next(ev for (s, ev), _v in results if s == ABSENT), required
    return FAIL, results[0][0][1], required


def role_fit(title: str, target: str) -> tuple[str, str]:
    """Is this job title the role wanted? The wanted words must stand together in the title:
    'Senior Product Manager, Payments' is a Product Manager, but 'Product Marketing Manager' is a
    different job, and so is 'Product Owner'."""
    want = words(target)
    if not want:
        return UNKNOWN, "no role words to compare"
    have = words(title)
    n = len(want)
    if any(have[i : i + n] == want for i in range(len(have) - n + 1)):
        return PASS, f"'{title}' matches '{target}'"
    present = [w for w in want if w in have]
    if len(present) == n:
        # every word is there, but not together
        positions = [have.index(w) for w in want]
        if positions == sorted(positions):
            extra = [w for w in have[positions[0] : positions[-1] + 1] if w not in want]
            return FAIL, (
                f"'{title}' is a different role from '{target}'"
                + (f" ('{' '.join(extra)}' sits inside it)" if extra else "")
            )
        return UNKNOWN, f"'{title}' has the words of '{target}' in a different order"
    missing = [w for w in want if w not in have]
    if len(present) / n < 0.34 or all(w in GENERIC for w in present):
        return FAIL, f"'{title}' does not look like '{target}'"
    if any(w not in GENERIC for w in missing):
        # the wanted role has a specific word ('marketing') the title lacks: a different job
        return FAIL, f"'{title}' is a different role from '{target}' (no '{missing[0]}')"
    return UNKNOWN, f"'{title}' only partly matches '{target}'"


def role_could_fit(criteria: dict[str, Any], title: str) -> bool:
    """Could this job title be one of the roles wanted? Used only to thin out big public feeds; the
    real judgement is `evaluate`. With no role chosen, nothing is filtered."""
    wanted = [r["value"] for r in (criteria.get("roles") or [])]
    if not wanted:
        return True
    for target in wanted:
        status, why = role_fit(title, target)
        if status == PASS or "different order" in why:
            return True
    return False


def _role(posting: JobPosting) -> Any:
    def judge(target: str) -> tuple[str, str]:
        return role_fit(posting.title, target)

    return judge


# Words that make a place a requirement on the candidate ("US only", "must be based in Germany"),
# as opposed to just saying where the company or its office is.
_ONLY = r"(?:only|exclusively)"
_NEED = r"(?:must|need to|have to|required to)\s+(?:be|reside|live|work|be\s+located|be\s+based)"
_WHO = r"(?:based|located|resident|residents|citizens?|eligible|authori[sz]ed|permitted)"


def _restricts(posting: JobPosting, places: set[str]) -> str | None:
    """Does the listing say, in so many words, that the role is for people in one of these places?
    Returns the words that say so. A place that is only where the company or office is does not
    count, and neither does silence."""
    if (posting.evidence or {}).get("region_scope") == "candidate":
        return "the listing's own required-location field"  # the feed reports who may apply
    if posting.arrangement in ("onsite", "hybrid"):
        return f"the role is {posting.arrangement}"
    original = f"{posting.region or ''}. {posting.title}. {posting.description[:3000]}"
    text = original.lower()
    for place in sorted(places):
        aliases = {a for a, canon in COUNTRY_ALIASES.items() if canon == place}
        long_names = {place} | {a for a in aliases if len(a) > 2}
        p = "(?:" + "|".join(re.escape(n) for n in sorted(long_names)) + ")"
        for pattern in (
            rf"\b{p}\b[^.\n]{{0,25}}\b{_ONLY}\b",
            rf"\b{_ONLY}\b[^.\n]{{0,30}}\b{p}\b",
            rf"\b{_NEED}\b[^.\n]{{0,40}}\b{p}\b",
            rf"\b{_WHO}\b[^.\n]{{0,25}}\b(?:in|of|to work in)\b[^.\n]{{0,15}}\b{p}\b",
            rf"\b{p}[- ]based\b",
        ):
            m = re.search(pattern, text)
            if m:
                return f"it says '{m.group(0).strip()}'"
        # "US" and "UK" are only the places when written in capitals ("join us" is not)
        for short in sorted(a.upper() for a in aliases if len(a) <= 2):
            for pattern in (
                rf"\b{short}[- ](?:only|based)\b",
                rf"\b{short}\s+(?:citizens?|residents?)\b",
                rf"(?i:\b{_ONLY}\b)\s+(?:in\s+)?(?:the\s+)?{short}\b",
                rf"(?i:\b{_NEED}\b)[^.\n]{{0,40}}?\b(?:the\s+)?{short}\b",
            ):
                m = re.search(pattern, original)
                if m:
                    return f"it says '{m.group(0).strip()}'"
    return None


# "All countries" in the search: the candidate can work anywhere, so no place is held against a job
ANYWHERE = {"all countries", "all available countries", "worldwide", "anywhere", "global"}


def _where(posting: JobPosting) -> Any:
    def judge(target: str) -> tuple[str, str]:
        if target.strip().lower() in ANYWHERE:
            return PASS, "you can work in any country"
        region = posting.region
        if not region:
            why = (
                "remote, but the listing does not say who may apply"
                if posting.arrangement == "remote"
                else "the listing does not say where the role is"
            )
            return ABSENT, why
        low = region.lower()
        if any(g in low for g in GLOBAL_REGION):
            return PASS, f"open to candidates anywhere ('{region}')"
        have = _named(region)
        if have and _covers(have, target):
            return PASS, f"'{region}' includes '{target}'"
        # A place that does not include the candidate is a reason to skip only when the listing
        # says the role is for people there. Otherwise it is where the company is, and not held
        # against the job.
        said = _restricts(posting, have) if have else None
        if said:
            return FAIL, f"the role is for '{region}' ({said}), not '{target}'"
        return ABSENT, (
            f"the listing names '{region}' but does not say the role is only for people there"
        )

    return judge


def _same(actual: str | None, label: str) -> Any:
    def judge(target: str) -> tuple[str, str]:
        if actual is None:
            return ABSENT, f"the listing does not state the {label}"
        if actual == target:
            return PASS, f"{label}: {actual.replace('_', ' ')}"
        return FAIL, f"{label} is {actual.replace('_', ' ')}, not {target.replace('_', ' ')}"

    return judge


def _industry(posting: JobPosting) -> Any:
    def judge(target: str) -> tuple[str, str]:
        if not posting.industry:
            return ABSENT, "the listing does not state the industry"
        if target.lower() in posting.industry.lower() or posting.industry.lower() in target.lower():
            return PASS, f"industry: {posting.industry}"
        return FAIL, f"industry is {posting.industry}"

    return judge


def _salary(floor: dict[str, Any], posting: JobPosting) -> tuple[str, str]:
    """Compared only when the currency and the pay period are the same; otherwise unknown. A listing
    that gives no pay at all is not held against it."""
    top = posting.salary_max if posting.salary_max is not None else posting.salary_min
    if top is None:
        return ABSENT, "the listing does not state the pay"
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


def _no_way_to_apply(posting: JobPosting) -> str:
    """Why a job cannot be applied for from here: it needs an email address to write to, or an
    application link on a site whose form we can fill in."""
    host = urlsplit(posting.application_url or "").hostname
    if host:
        return (
            f"it lists no email address, and its application link ({host}) is on a site we cannot "
            "fill in yet: open the job to apply yourself"
        )
    return (
        "it lists neither an email address nor an application link: open the job to apply yourself"
    )


def evaluate(
    criteria: dict[str, Any],
    posting: JobPosting,
    *,
    now: datetime,
    routes: set[str],
    channels: dict[str, bool],
    overrides: set[str] | None = None,
    manual: bool = False,
) -> Match:
    """Judge every criterion. `routes` is how this posting can be applied to (form, email);
    `overrides` are rules the candidate has looked at and approved by hand. `manual` says the
    listing has an application link we cannot fill in: the job is kept, and prepared for the
    candidate to submit on the employer's own site."""
    overrides = overrides or set()
    rules: list[Rule] = []

    def add(key: str, label: str, status: str, evidence: str, required: bool) -> None:
        stated = status != ABSENT
        if status == ABSENT:  # the listing does not say: it passes, without counting as a good sign
            status, evidence = PASS, f"{evidence}, so it is not held against the job"
        if status == UNKNOWN and key in overrides:
            status, evidence = PASS, f"you confirmed this yourself ({evidence})"
        rules.append(Rule(key, label, required, status, evidence, stated))

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
        source = {"role": "roles", "location": "locations", "industry": "industries"}.get(key, key)
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
        how = {"form": "its application form (filled in for you)", "email": "email"}
        add(
            "channel",
            "A way to apply",
            PASS,
            "can apply by " + " or ".join(how.get(r, r) for r in sorted(usable)),
            True,
        )
    elif manual and posting.application_url:
        host = urlsplit(posting.application_url).hostname or "the employer's site"
        why = (
            "the ways we could apply for you are switched off in your search"
            if routes
            else "it is on a site we cannot fill in yet"
        )
        add(
            "channel",
            "A way to apply",
            PASS,
            f"it has an application link ({host}) and {why}: your CV and note are prepared and "
            "you submit it there",
            True,
        )
    elif routes:
        add(
            "channel",
            "A way to apply",
            FAIL,
            f"the listing accepts {' or '.join(sorted(routes))}, which you switched off",
            True,
        )
    else:
        add("channel", "A way to apply", FAIL, _no_way_to_apply(posting), True)

    failed = [r for r in rules if r.required and r.status == FAIL]
    unknown = [r for r in rules if r.required and r.status == UNKNOWN]
    score = sum(
        (1.0 if r.status == PASS and r.stated else -1.0 if r.status == FAIL else 0.0)
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
