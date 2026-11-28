"""Answers that let an application go through on its own: saved answers under every name, search
preferences, CV facts, consent boxes, and answers written from the CV (never a legal statement)."""

import asyncio
import json
from datetime import UTC, datetime

from app.autoapply import answers
from app.autoapply.package import resolve_answers
from app.models import CandidateAnswer

NOW = datetime(2026, 11, 28, tzinfo=UTC)
FACTS = {
    "contact": {"name": "Ada Obi", "email": "ada@example.com", "location": "Lagos, Nigeria"},
    "history": [
        {"title": "Product Manager", "company": "Acme", "start": "Jan 2021", "end": "Present"},
        {"title": "Analyst", "company": "Beta", "start": "2018", "end": "2020"},
    ],
    "skills": ["SQL", "Figma"],
}


def saved(**kw: str) -> dict[str, CandidateAnswer]:
    return {k: CandidateAnswer(field=k, value=v, reusable=True) for k, v in kw.items()}


def test_saved_answers_answer_every_name_forms_use():
    got = answers.known(
        saved(sponsorship="No", relocation="Within Nigeria", notice_period="Two weeks"),
        None,
        FACTS,
        NOW,
    )
    assert got["requires_sponsorship"]["value"] == "No"
    assert got["sponsorship"]["value"] == "No"
    assert got["relocate"]["value"] == "Within Nigeria"
    assert got["notice_period"]["value"] == "Two weeks"
    assert got["years_experience"] == {"value": "8", "source": "your verified CV"}


def test_search_preferences_fill_what_was_not_saved():
    crit = {
        "sponsorship": {"need": "not_needed", "required": True},
        "salary": {"floor": 90000, "currency": "usd", "period": "year"},
    }
    got = answers.known({}, crit, FACTS, NOW)
    assert got["requires_sponsorship"]["value"] == "No"
    assert got["salary_expectation"]["value"] == "90,000 USD a year"
    # a saved answer wins over the preference
    got = answers.known(saved(sponsorship="Yes"), crit, FACTS, NOW)
    assert got["requires_sponsorship"]["value"] == "Yes"


def test_an_answer_not_approved_for_reuse_is_not_used():
    a = CandidateAnswer(field="notice_period", value="Now", reusable=False)
    assert "notice_period" not in answers.known({"notice_period": a}, None, {}, NOW)


def test_the_package_uses_them_and_ticks_consent_but_never_a_legal_statement():
    questions = [
        {"field": "requires_sponsorship", "label": "Visa sponsorship?", "kind": "choice"},
        {"field": "privacy", "label": "I agree to the privacy policy", "kind": "declaration"},
        {
            "field": "auth",
            "label": "I certify I am legally authorized to work",
            "kind": "declaration",
        },
    ]
    extra = answers.known(saved(sponsorship="No"), None, FACTS, NOW)
    got, missing = resolve_answers(questions, FACTS, {}, {}, extra)
    assert got["requires_sponsorship"]["value"] == "No"
    assert got["privacy"]["value"] == "Yes"
    assert [m["field"] for m in missing] == ["auth"]


class Llm:
    def __init__(self, reply: dict[str, str]) -> None:
        self.reply = reply
        self.asked: list[str] = []

    async def generate_json(self, *, system, user, schema):  # type: ignore[no-untyped-def]
        q = json.loads(user)["questions"]
        self.asked = [x["field"] for x in q]
        return json.dumps({"answers": [{"field": k, "value": v} for k, v in self.reply.items()]})


def test_other_questions_are_written_from_the_cv_and_checked():
    llm = Llm(
        {
            "why": "I have led product work at Acme and want to build tools like yours.",
            "sql": "yes",
            "made_up": "I grew revenue by 300% at Acme.",  # a number the CV never had
            "bad_choice": "Maybe",
        }
    )
    qs = [
        {"field": "why", "question": "Why do you want to work here?"},
        {"field": "sql", "question": "Do you know SQL?", "options": ["Yes", "No"]},
        {"field": "made_up", "question": "Your biggest win?"},
        {"field": "bad_choice", "question": "Pick one", "options": ["A", "B"]},
        {"field": "auth", "question": "Are you legally authorized to work in the US?"},
        {"field": "terms", "question": "I agree to the terms"},
    ]
    got = asyncio.run(answers.draft(llm, qs, facts=FACTS, cv_text="", saved={}, job={}))
    assert got["why"].startswith("I have led")
    assert got["sql"] == "Yes", "a choice is the form's own option"
    assert got["terms"] == "Yes"
    assert "made_up" not in got and "bad_choice" not in got
    assert "auth" not in got and "auth" not in llm.asked, "a legal statement is never written"


def test_a_legal_question_uses_only_the_candidates_own_answer_in_the_forms_words():
    llm = Llm({"us_citizen": "No"})
    qs = [
        {
            "field": "us_citizen",
            "question": "Are you a U.S. citizen?",
            "options": ["Yes", "No"],
        },
        {
            "field": "clearance",
            "question": "Do you hold a security clearance?",
            "options": ["Yes", "No"],
        },
    ]
    own = {"us_citizen": {"value": "Nigerian citizen", "source": "saved answer"}}
    got = asyncio.run(answers.draft(llm, qs, facts=FACTS, cv_text="", saved=own, job={}))
    assert got == {"us_citizen": "No"}
    assert llm.asked == ["us_citizen"], "a legal question without a saved answer is never sent"


def test_new_legal_questions_have_their_own_names_on_forms():
    from app.autoapply.browserform import semantic

    assert semantic("Are you a U.S. citizen or permanent resident?") == "citizenship"
    assert semantic("Do you hold an active security clearance?") == "security_clearance"
    assert semantic("Have you ever been convicted of a felony?") == "criminal_record"
    got = answers.known(saved(criminal="No", clearance="None"), None, {}, NOW)
    assert got["criminal_record"]["value"] == "No"
    assert got["security_clearance"]["value"] == "None"


def test_a_saved_answer_not_in_the_forms_words_is_rewritten_not_sent_as_is():
    q = [
        {
            "field": "citizenship",
            "label": "Are you a citizen?",
            "kind": "choice",
            "options": ["Yes", "No"],
        }
    ]
    extra = answers.known(saved(citizenship="Nigerian citizen"), None, {}, NOW)
    got, missing = resolve_answers(q, {}, {}, {}, extra)
    assert "citizenship" not in got and missing[0]["field"] == "citizenship"
