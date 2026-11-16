"""Gap finder: where the notes or the brief had nothing to offer, so the user knows what to add."""

from dataclasses import dataclass, field

from app.models import Suggestion

NO_STORY = "no matching story in your notes"


@dataclass
class Gap:
    kind: str  # experience | company
    type: str
    questions: list[str] = field(default_factory=list)
    hint: str = ""


def find_gaps(suggestions: list[Suggestion]) -> list[Gap]:
    """From the outlines of a session: question types with no matching note, and company questions
    answered without any brief fact."""
    grouped: dict[tuple[str, str], Gap] = {}
    for s in suggestions:
        text = (s.output_text or "").lower()
        kind: str | None = None
        if NO_STORY in text:
            kind = "experience"
        elif s.type == "company" and not any(
            str(src).lower().startswith("brief") for src in (s.sources_used or [])
        ):
            kind = "company"
        if kind is None:
            continue
        typ = s.type or "other"
        gap = grouped.setdefault(
            (kind, typ),
            Gap(
                kind=kind,
                type=typ,
                hint=(
                    f"Add a {typ} story to your notes: the situation, what you did, and the result."
                    if kind == "experience"
                    else "Add facts about the company: research it, or paste text from its pages."
                ),
            ),
        )
        if s.question_text and s.question_text not in gap.questions:
            gap.questions.append(s.question_text)
    return list(grouped.values())
