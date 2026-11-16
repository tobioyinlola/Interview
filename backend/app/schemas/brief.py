"""The company brief: what the model is asked to return, what we store, and the validator that
turns the first into the second. A fact with no valid source never reaches storage."""

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_FACT_CHARS = 500
MAX_LIKELY_QUESTIONS = 10
MAX_QUESTIONS_TO_ASK = 5

# Fixed order and titles. Keys double as the field names in the model's output.
FACT_SECTIONS: list[tuple[str, str]] = [
    ("snapshot", "Snapshot"),
    ("products_customers", "Products and customers"),
    ("recent_news", "Recent news"),
    ("culture_values", "Culture and values"),
    ("the_role", "The role"),
    ("interview_process", "Interview process"),
]
SUGGESTION_SECTIONS: list[tuple[str, str]] = [
    ("likely_questions", "Likely questions"),
    ("questions_to_ask", "Questions to ask"),
]

Label = Literal["from_you", "pasted_by_you", "suggestion"]


# ------------------------------------------------------ what the model returns


class LlmFact(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text: str
    source_ids: list[int] = Field(default_factory=list)
    date: str | None = None


class LlmQuestion(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text: str
    source_ids: list[int] = Field(default_factory=list)


class LlmBrief(BaseModel):
    """Source ids are small integers that index the numbered sources given in the prompt."""

    model_config = ConfigDict(extra="ignore")
    assumed_company: str | None = None
    snapshot: list[LlmFact] = Field(default_factory=list)
    products_customers: list[LlmFact] = Field(default_factory=list)
    recent_news: list[LlmFact] = Field(default_factory=list)
    culture_values: list[LlmFact] = Field(default_factory=list)
    the_role: list[LlmFact] = Field(default_factory=list)
    interview_process: list[LlmFact] = Field(default_factory=list)
    likely_questions: list[LlmQuestion] = Field(default_factory=list)
    questions_to_ask: list[LlmQuestion] = Field(default_factory=list)


# ------------------------------------------------------------- what we store


class BriefFact(BaseModel):
    id: uuid.UUID
    text: str
    source_ids: list[uuid.UUID]
    date: str | None = None
    label: Label | None = None
    pinned: bool = False
    edited_by_user: bool = False


class BriefSection(BaseModel):
    key: str
    title: str
    facts: list[BriefFact]
    not_found: bool  # True means show "Not found" instead of content


class BriefContent(BaseModel):
    assumed_company: str | None = None  # shown first when the name matched several companies
    web_search_done: bool = True
    no_website: bool = False
    dropped_facts: int = 0  # how many model facts failed the source check (for evaluation)
    sections: list[BriefSection]


class SourceRef(BaseModel):
    """What the validator needs to know about a source."""

    id: uuid.UUID
    kind: str  # website | job_posting | extra_link | search_result | pasted | known
    url: str | None


def _clean(text: str) -> str:
    return " ".join(text.split())[:MAX_FACT_CHARS]


def _label_for(cited: list[SourceRef]) -> Label | None:
    kinds = {s.kind for s in cited}
    if kinds == {"known"}:
        return "from_you"
    if kinds == {"pasted"}:
        return "pasted_by_you"
    return None


def _source_is_valid(src: SourceRef) -> bool:
    """A source counts only if it has a working link, or is text the user supplied."""
    if src.kind in ("known", "pasted"):
        return True
    return bool(src.url) and src.url.lower().startswith(("http://", "https://"))  # type: ignore[union-attr]


def build_brief(
    raw: dict[str, Any],
    sources_by_index: dict[int, SourceRef],
    *,
    web_search_done: bool,
    no_website: bool,
) -> BriefContent:
    """Validate a model answer against the sources the job actually collected.

    - unknown or invalid source ids are removed from a fact; a fact left with none is dropped
    - sections with no surviving fact show "Not found" (never a guess)
    - suggestions (likely questions, questions to ask) are labelled and capped
    - the model's own claims about *which company* it assumed are kept as text only
    """
    brief = LlmBrief.model_validate(raw)
    valid = {i: s for i, s in sources_by_index.items() if _source_is_valid(s)}
    dropped = 0
    sections: list[BriefSection] = []

    for key, title in FACT_SECTIONS:
        facts: list[BriefFact] = []
        seen: set[str] = set()
        for item in getattr(brief, key):
            text = _clean(item.text)
            cited = [valid[i] for i in dict.fromkeys(item.source_ids) if i in valid]
            if not text or not cited or text.lower() in seen:
                dropped += 1 if text and not cited else 0
                continue
            seen.add(text.lower())
            facts.append(
                BriefFact(
                    id=uuid.uuid4(),
                    text=text,
                    source_ids=[s.id for s in cited],
                    date=item.date.strip()[:40] if item.date else None,
                    label=_label_for(cited),
                )
            )
        sections.append(BriefSection(key=key, title=title, facts=facts, not_found=not facts))

    for key, title in SUGGESTION_SECTIONS:
        cap = MAX_LIKELY_QUESTIONS if key == "likely_questions" else MAX_QUESTIONS_TO_ASK
        questions: list[BriefFact] = []
        seen_q: set[str] = set()
        for item in getattr(brief, key):
            text = _clean(item.text)
            if not text or text.lower() in seen_q:
                continue
            seen_q.add(text.lower())
            cited = [valid[i] for i in dict.fromkeys(item.source_ids) if i in valid]
            questions.append(
                BriefFact(
                    id=uuid.uuid4(),
                    text=text,
                    source_ids=[s.id for s in cited],
                    label="suggestion",  # always a suggestion, never presented as a fact
                )
            )
            if len(questions) >= cap:
                break
        sections.append(
            BriefSection(key=key, title=title, facts=questions, not_found=not questions)
        )

    assumed = _clean(brief.assumed_company) if brief.assumed_company else None
    return BriefContent(
        assumed_company=assumed or None,
        web_search_done=web_search_done,
        no_website=no_website,
        dropped_facts=dropped,
        sections=sections,
    )


def fact_count(content: BriefContent) -> int:
    """Sourced facts only (suggestions do not count as research)."""
    return sum(len(s.facts) for s in content.sections if s.key in dict(FACT_SECTIONS))
