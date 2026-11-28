"""Answers to the questions application forms ask, so that an application goes through on its own.

Layers, in order (the first with a real answer wins):

1. what the candidate answered for this application;
2. the candidate's saved answers (Auto-Apply setup, "your quick answers"), under every name forms
   use for the same question (a saved "sponsorship" answers "requires_sponsorship" too);
3. what the candidate's search preferences already say (visa sponsorship needed or not, salary
   floor) and what the verified CV facts hold (contact details, years of experience);
4. consent boxes ("I agree to the privacy policy", "the information is accurate"): ticked, since
   the candidate authorised Auto-Apply to apply for them;
5. anything else the form requires is written by a model from the CV facts and the job, and checked:
   a choice must be one of the form's own options, free text may not bring in a number the CV does
   not have.

Legal statements (right to work, sponsorship, citizenship, clearance, criminal record) are only ever
the candidate's own saved answers: they are never written by a model. Without one, the application
asks the candidate once, and the answer is saved for every later form."""

import json
import re
from datetime import datetime
from typing import Any

from app.adapters.interfaces import LlmProvider, ProviderError
from app.autoapply.tailor import fact_text, invented_numbers
from app.models import CandidateAnswer
from app.services.untrusted import UNTRUSTED_NOTE, safe_to_send

# names a saved answer is kept under -> the name forms use for it
ALIASES = {
    "sponsorship": "requires_sponsorship",
    "visa_sponsorship": "requires_sponsorship",
    "needs_sponsorship": "requires_sponsorship",
    "relocation": "relocate",
    "willing_to_relocate": "relocate",
    "salary": "salary_expectation",
    "expected_salary": "salary_expectation",
    "years_of_experience": "years_experience",
    "experience_years": "years_experience",
    "start_date": "notice_period",
    "availability": "notice_period",
    "work_authorisation": "work_authorization",
    "right_to_work": "work_authorization",
    "citizen": "citizenship",
    "nationality": "citizenship",
    "clearance": "security_clearance",
    "criminal": "criminal_record",
    "convictions": "criminal_record",
}

LEGAL = re.compile(
    r"sponsor|visa|legally|authori[sz]|eligib|right to work|citizen|permanent resident|green card"
    r"|clearance|criminal|convict|felony|background check|non-?compete|work permit",
    re.I,
)
LEGAL_FIELDS = {"requires_sponsorship", "work_authorization"}
CONSENT = re.compile(
    r"\b(i )?(agree|consent|acknowledge|accept|certify|confirm|attest|understand|have read)\b"
    r"|privacy|terms|data (processing|protection)|accurate|true and (complete|correct)",
    re.I,
)
YEAR = re.compile(r"(19|20)\d{2}")


def canonical(field: str) -> str:
    return ALIASES.get(field, field)


def is_legal(field: str, question: str) -> bool:
    return field in LEGAL_FIELDS or bool(LEGAL.search(question or ""))


def years_of_experience(facts: dict[str, Any], now: datetime) -> str:
    """Whole years since the earliest start date in the verified work history, or ""."""
    years = []
    for job in facts.get("history") or []:
        if isinstance(job, dict):
            m = YEAR.search(str(job.get("start") or ""))
            if m:
                years.append(int(m.group(0)))
    if not years:
        return ""
    n = now.year - min(years)
    return str(n) if 0 < n < 60 else ""


def known(
    saved: dict[str, CandidateAnswer],
    criteria: dict[str, Any] | None,
    facts: dict[str, Any],
    now: datetime,
) -> dict[str, dict[str, str]]:
    """Everything already known about the candidate, under the names forms use: {field: {value,
    source}}. Saved answers come first, then search preferences, then the CV facts."""
    out: dict[str, dict[str, str]] = {}
    for a in saved.values():
        value = (a.value or "").strip()
        if not value or not a.reusable:
            continue
        for name in {a.field, canonical(a.field)}:
            out.setdefault(name, {"value": value, "source": "saved answer"})
    c = criteria or {}
    spon = c.get("sponsorship") if isinstance(c.get("sponsorship"), dict) else None
    if spon and spon.get("need") in ("needed", "not_needed"):
        out.setdefault(
            "requires_sponsorship",
            {
                "value": "Yes" if spon["need"] == "needed" else "No",
                "source": "your search preferences",
            },
        )
    sal = c.get("salary") if isinstance(c.get("salary"), dict) else None
    if sal and sal.get("floor"):
        try:
            floor = f"{int(float(sal['floor'])):,}"
        except (TypeError, ValueError):
            floor = ""
        if floor:
            cur = str(sal.get("currency") or "").upper()
            per = {"year": "a year", "month": "a month", "hour": "an hour"}.get(
                str(sal.get("period") or ""), ""
            )
            text = " ".join(x for x in (floor, cur, per) if x)
            out.setdefault(
                "salary_expectation", {"value": text, "source": "your search preferences"}
            )
    yrs = years_of_experience(facts, now)
    if yrs:
        out.setdefault("years_experience", {"value": yrs, "source": "your verified CV"})
    return out


def consent(question: str) -> bool:
    """An agreement box the candidate already gave by turning Auto-Apply on."""
    return bool(CONSENT.search(question or "")) and not LEGAL.search(question or "")


DRAFT_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answers"],
    "properties": {
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["field", "value"],
                "properties": {"field": {"type": "string"}, "value": {"type": "string"}},
            },
        }
    },
}

DRAFT_PROMPT = (
    "You fill in the questions of a job application form on behalf of the candidate, who asked "
    "for it to be done for them. Use only the candidate's verified CV facts and saved answers. "
    "Rules: for a question with options, the value must be exactly one of the options, copied "
    "letter for letter (for several choices, separate them with ';'). For a yes/no question about "
    "skills or experience, answer from the CV: Yes only if the CV shows it, otherwise No. For a "
    "free-text question (why this company, about yourself, a project), write 2 to 4 plain "
    "first-person sentences grounded in the CV and the job, no greetings, no invented numbers, "
    "names or employers. For a short-answer field (a city, a URL, a number of years) give just "
    "that. A question that comes with 'your_saved_answer' (right to work, sponsorship, "
    "citizenship, clearance, criminal record) is answered only by choosing the option that says "
    "the same as that saved answer; if none clearly does, return an empty value. "
    "If the CV and saved answers do not let you answer honestly, return an empty value. "
    + UNTRUSTED_NOTE
)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _option(options: list[str], value: str) -> str:
    want = _norm(value)
    for o in options:
        if _norm(o) == want:
            return o
    for o in options:
        n = _norm(o)
        if n and want and (n in want or want in n) and min(len(n), len(want)) >= 2:
            return o
    return ""


async def draft(
    llm: LlmProvider,
    questions: list[dict[str, Any]],
    *,
    facts: dict[str, Any],
    cv_text: str,
    saved: dict[str, dict[str, str]],
    job: dict[str, str],
) -> dict[str, str]:
    """Answers for required questions nothing else could answer: {field: value}. Legal statements
    are never drafted; a choice is always one of the form's options; anything that fails the
    checks is left out (the question is then asked of the candidate)."""

    def own(q: dict[str, Any]) -> str:
        # the candidate's own saved answer for a legal question, under any of its names
        f = str(q.get("field") or "")
        hit = saved.get(f) or saved.get(canonical(f)) or {}
        return str(hit.get("value") or "")

    # a legal question goes on only to put the candidate's own saved answer into the form's words
    wanted = [
        q
        for q in questions
        if q.get("field")
        and (
            not is_legal(str(q["field"]), str(q.get("question") or ""))
            or (own(q) and q.get("options"))
        )
    ][:20]
    out: dict[str, str] = {}
    rest = []
    for q in wanted:
        if consent(str(q.get("question") or "")) and not own(q):
            opts = [str(o) for o in q.get("options") or []]
            out[str(q["field"])] = (
                (_option(opts, "Yes") or _option(opts, "I agree")) if opts else "Yes"
            )
            if not out[str(q["field"])]:
                del out[str(q["field"])]
                rest.append(q)
        else:
            rest.append(q)
    if not rest:
        return out
    try:
        reply = await llm.generate_json(
            system=DRAFT_PROMPT,
            user=json.dumps(
                {
                    "facts": facts,
                    "saved_answers": {k: v["value"] for k, v in saved.items()},
                    "job": {k: str(v)[:3000] for k, v in job.items()},
                    "questions": [
                        {
                            "field": str(q["field"]),
                            "question": str(q.get("question") or "")[:300],
                            "options": [str(o)[:120] for o in (q.get("options") or [])][:60],
                            **(
                                {"your_saved_answer": own(q)[:300]}
                                if is_legal(str(q["field"]), str(q.get("question") or ""))
                                else {}
                            ),
                        }
                        for q in rest
                    ],
                }
            ),
            schema=DRAFT_SCHEMA,
        )
        items = json.loads(reply).get("answers", [])
    except (ProviderError, ValueError, TypeError, AttributeError):
        return out
    by = {str(q["field"]): q for q in rest}
    grounding = fact_text(facts, cv_text)
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        field, value = str(item.get("field") or ""), str(item.get("value") or "").strip()
        asked = by.get(field)
        if asked is None or not value:
            continue
        options = [str(o) for o in asked.get("options") or []]
        if options:
            parts = (
                [_option(options, v) for v in value.split(";")]
                if ";" in value
                else [_option(options, value)]
            )
            if not all(parts):
                continue
            out[field] = ";".join(parts)
        else:
            text = value[:1500]
            if invented_numbers(text, facts, cv_text) or not safe_to_send(text, grounding):
                continue
            out[field] = text
    return out


async def on_file(
    db: Any, user_id: Any, now: datetime
) -> tuple[dict[str, dict[str, str]], dict[str, Any]]:
    """(everything known for this person, their verified CV facts), read fresh at the time a form
    is filled, so answers saved after an application was prepared are used too."""
    from sqlalchemy import select

    from app.models import CandidateFacts, SearchProfile

    saved = {
        a.field: a
        for a in (
            await db.execute(select(CandidateAnswer).where(CandidateAnswer.user_id == user_id))
        ).scalars()
    }
    prof = (
        await db.execute(select(SearchProfile).where(SearchProfile.user_id == user_id))
    ).scalar_one_or_none()
    facts_row = (
        await db.execute(select(CandidateFacts).where(CandidateFacts.user_id == user_id))
    ).scalar_one_or_none()
    facts = dict(facts_row.data or {}) if facts_row is not None else {}
    return known(saved, prof.criteria if prof else None, facts, now), facts
