"""What a search profile may contain, checked once, here, so every route and job agrees."""

from typing import Any

from app.autoapply.clock import valid_timezone

ARRANGEMENTS = {"remote", "hybrid", "onsite"}
CONTRACTS = {"full_time", "part_time", "contract", "internship"}
SENIORITY = {"intern", "junior", "mid", "senior", "lead", "executive"}
PAY_PERIODS = {"hour", "day", "week", "month", "year"}
SPONSORSHIP = {"needed", "not_needed"}
CHANNELS = ("form", "email", "outreach")
MAX_LIST = 20


class ProfileProblem(ValueError):
    """The profile cannot be saved or enabled, for a reason the person can fix."""


def _text(value: Any, what: str, limit: int = 120) -> str:
    text = str(value or "").strip()
    if not text:
        raise ProfileProblem(f"{what} cannot be empty.")
    return text[:limit]


def _flagged(items: Any, what: str) -> list[dict[str, Any]]:
    """A list of {value, required}. Each criterion can be required (a hard rule) or preferred."""
    if items in (None, ""):
        return []
    if not isinstance(items, list) or len(items) > MAX_LIST:
        raise ProfileProblem(f"{what} must be a short list.")
    out: list[dict[str, Any]] = []
    for it in items:
        if isinstance(it, str):
            it = {"value": it}
        if not isinstance(it, dict):
            raise ProfileProblem(f"{what} has an entry that is not understood.")
        out.append({"value": _text(it.get("value"), what), "required": bool(it.get("required"))})
    return out


def _choice(items: Any, allowed: set[str], what: str) -> list[dict[str, Any]]:
    out = _flagged(items, what)
    for it in out:
        it["value"] = it["value"].lower().replace("-", "_").replace(" ", "_")
        if it["value"] not in allowed:
            raise ProfileProblem(f"{what}: '{it['value']}' is not one of {sorted(allowed)}.")
    return out


def clean_criteria(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalise the criteria. Unknown keys are dropped, not stored."""
    out: dict[str, Any] = {
        "roles": _flagged(raw.get("roles"), "Target roles"),
        "locations": _flagged(raw.get("locations"), "Locations or work regions"),
        "industries": _flagged(raw.get("industries"), "Industries"),
        "seniority": _choice(raw.get("seniority"), SENIORITY, "Seniority"),
        "arrangement": _choice(raw.get("arrangement"), ARRANGEMENTS, "Work arrangement"),
        "contract": _choice(raw.get("contract"), CONTRACTS, "Contract type"),
    }
    salary = raw.get("salary")
    if salary:
        try:
            amount = float(salary.get("floor"))
        except (TypeError, ValueError, AttributeError):
            raise ProfileProblem("The salary floor must be a number.") from None
        currency = str(salary.get("currency") or "").upper().strip()
        period = str(salary.get("period") or "").lower().strip()
        if amount <= 0 or len(currency) != 3 or not currency.isalpha():
            raise ProfileProblem("Give the salary floor with a three-letter currency, such as USD.")
        if period not in PAY_PERIODS:
            raise ProfileProblem(f"The pay period must be one of {sorted(PAY_PERIODS)}.")
        out["salary"] = {
            "floor": amount,
            "currency": currency,
            "period": period,
            "required": bool(salary.get("required")),
        }
    sponsorship = raw.get("sponsorship")
    if sponsorship:
        need = str(sponsorship.get("need") or "").lower()
        if need not in SPONSORSHIP:
            raise ProfileProblem("Say whether you need visa sponsorship.")
        out["sponsorship"] = {"need": need, "required": bool(sponsorship.get("required"))}
    return out


def clean_hours(raw: Any) -> dict[str, int]:
    if not raw:
        return {}
    try:
        start, end = int(raw["start"]), int(raw["end"])
    except (KeyError, TypeError, ValueError):
        raise ProfileProblem("Active hours need a start and an end hour.") from None
    if not (0 <= start <= 23 and 0 <= end <= 24):
        raise ProfileProblem("Active hours must be between 0 and 24.")
    return {"start": start, "end": end}


def clean_channels(raw: Any) -> dict[str, bool]:
    raw = raw or {}
    return {c: bool(raw.get(c)) for c in CHANNELS}


def clean_timezone(name: str) -> str:
    name = (name or "").strip()
    if not valid_timezone(name):
        raise ProfileProblem("That timezone is not recognised. Use a name like Africa/Lagos.")
    return name


def readiness_problems(
    criteria: dict[str, Any], channels: dict[str, bool], has_cv: bool
) -> list[str]:
    """Everything still missing before Auto-Apply can be switched on."""
    problems: list[str] = []
    if not has_cv:
        problems.append("Upload your CV first.")
    if not criteria.get("roles"):
        problems.append("Add at least one target role.")
    if not criteria.get("locations"):
        problems.append("Add a work location or the region you can work from.")
    if not any(channels.values()):
        problems.append("Choose at least one way to apply: employer forms or email.")
    return problems
