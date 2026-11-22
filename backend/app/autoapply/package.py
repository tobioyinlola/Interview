"""The application package: everything that will be sent for one application, frozen so that what
was submitted can always be shown exactly, whatever the candidate edits afterwards."""

from datetime import datetime
from typing import Any

from app.adapters.interfaces import LlmProvider
from app.autoapply import tailor
from app.models import Application, CandidateAnswer, CandidateFacts, JobPosting

# Application states after which the package may never change again.
FROZEN = {"sending", "submitted", "sent_email", "confirmation_pending"}
SUPPORTED_KINDS = {"text", "choice", "declaration"}
# Form questions the verified CV facts can answer on their own.
FROM_FACTS = {
    "name": ("contact", "name"),
    "full_name": ("contact", "name"),
    "email": ("contact", "email"),
    "phone": ("contact", "phone"),
    "location": ("contact", "location"),
}


class FrozenError(Exception):
    """A package that has already gone out cannot be rebuilt."""


def posting_snapshot(p: JobPosting) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "company": p.company,
        "title": p.title,
        "requisition_id": p.requisition_id,
        "description": p.description,
        "region": p.region,
        "arrangement": p.arrangement,
        "contract": p.contract,
        "salary": [p.salary_min, p.salary_max, p.salary_currency, p.salary_period],
        "sponsorship": p.sponsorship,
        "application_url": p.application_url,
        "apply_email": p.apply_email,
        "apply_instructions": p.apply_instructions,
        "evidence": p.evidence,
    }


def resolve_answers(
    questions: list[dict[str, Any]],
    facts: dict[str, Any],
    per_application: dict[str, Any],
    saved: dict[str, CandidateAnswer],
) -> tuple[dict[str, dict[str, str]], list[dict[str, Any]]]:
    """Fill in the form's questions from what is known, and list exactly what is still missing.

    Order: an answer given for this application; then a saved answer the candidate approved for
    reuse; then a verified CV fact. A declaration is only ever the candidate's own, given for this
    application, and an answer is never invented."""
    answers: dict[str, dict[str, str]] = {}
    missing: list[dict[str, Any]] = []
    for q in questions:
        field = str(q.get("field", ""))
        label = str(q.get("label") or field)
        required = bool(q.get("required", True))
        kind = str(q.get("kind", "text"))
        if kind not in SUPPORTED_KINDS:
            missing.append(
                {
                    "kind": "unsupported",
                    "field": field,
                    "question": label,
                    "reason": f"This form has a {kind} step that cannot be done automatically.",
                }
            )
            continue
        if field in per_application:
            answers[field] = {"value": str(per_application[field]), "source": "this application"}
            continue
        if kind == "declaration":
            if required:
                missing.append(
                    {
                        "kind": "declaration",
                        "field": field,
                        "question": label,
                        "reason": "Only you can make this declaration.",
                    }
                )
            continue
        if field in saved and saved[field].reusable:
            answers[field] = {"value": saved[field].value, "source": "saved answer"}
            continue
        if field in FROM_FACTS:
            section, key = FROM_FACTS[field]
            value = facts.get(section, {}).get(key, "")
            if value:
                answers[field] = {"value": value, "source": "your verified CV"}
                continue
        if required:
            missing.append(
                {
                    "kind": "answer",
                    "field": field,
                    "question": label,
                    "reason": "The form needs this and you have not answered it yet.",
                }
            )
    return answers, missing


async def build(
    *,
    app: Application,
    posting: JobPosting,
    facts_row: CandidateFacts | None,
    cv_text: str,
    saved: dict[str, CandidateAnswer],
    llm: LlmProvider,
    channel: str,
    match: dict[str, Any],
    profile_version: int,
    now: datetime,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """(package, missing). `missing` empty means the package is complete; the caller freezes it."""
    if app.status in FROZEN:
        raise FrozenError("this application has already gone out")
    if facts_row is None or facts_row.verified_at is None:
        return None, [
            {
                "kind": "verify_facts",
                "field": "",
                "question": "Check the details read from your CV",
                "reason": "Confirm your work history, contact details and skills before applying.",
            }
        ]
    facts = facts_row.data
    answers, missing = resolve_answers(posting.questions or [], facts, app.answers or {}, saved)
    if missing:
        return None, missing
    # The contact details every form asks for always travel with the package, taken from the
    # facts the candidate verified, so a form that asks for them later can be filled honestly.
    for field, (section, key) in FROM_FACTS.items():
        value = facts.get(section, {}).get(key, "")
        if value and field not in answers:
            answers[field] = {"value": value, "source": "your verified CV"}
    cv_out, note = await tailor.tailor_cv(llm, facts, cv_text, posting)
    cover = await tailor.cover_note(llm, facts, cv_text, posting)
    destination = (
        {"channel": "form", "url": posting.application_url}
        if channel == "form"
        else {
            "channel": "email",
            "to": posting.apply_email,
            "instructions": posting.apply_instructions,
        }
    )
    return {
        "posting": posting_snapshot(posting),
        "destination": destination,
        "cv": {
            "original_text": cv_text,  # the CV as it was when this was prepared
            "submitted_text": cv_out,  # exactly what is sent
            "facts_version": facts_row.version,
            "tailoring": note,
        },
        "answers": answers,
        "cover_text": cover,
        "match": match,
        "profile_version": profile_version,
        "prepared_at": now.isoformat(),
    }, []


def freeze(app: Application, package: dict[str, Any], now: datetime) -> None:
    if app.status in FROZEN:
        raise FrozenError("this application has already gone out")
    app.package = package
    app.package_frozen_at = now
