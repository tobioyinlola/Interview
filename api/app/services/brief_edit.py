"""Changes the user makes to a brief, and how they survive a refresh.

The rule that keeps the brief trustworthy: a researched fact always cites a source. Facts the user
adds are labelled "From you" and may have none. When a source is removed, researched facts that
cited only it are dropped; the user's own facts stay."""

import uuid
from dataclasses import dataclass

from app.schemas.brief import FACT_SECTIONS, SUGGESTION_SECTIONS, BriefContent, BriefFact

VALID_KEYS = {k for k, _ in FACT_SECTIONS + SUGGESTION_SECTIONS}
MAX_FACTS_PER_SECTION = 60


class EditError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class FactEdit:
    section_key: str
    text: str
    id: uuid.UUID | None = None
    pinned: bool = False
    delete: bool = False


def _refresh_flags(content: BriefContent) -> BriefContent:
    for s in content.sections:
        s.not_found = len(s.facts) == 0
    return content


def _clean(text: str) -> str:
    return " ".join(text.split())[:500]


def apply_edits(content: BriefContent, edits: list[FactEdit]) -> BriefContent:
    """Update, pin, add or delete facts. `content` is modified and returned."""
    sections = {s.key: s for s in content.sections}
    for e in edits:
        if e.section_key not in VALID_KEYS or e.section_key not in sections:
            raise EditError("invalid_section", "That section does not exist.")
        section = sections[e.section_key]
        if e.id is None:
            if e.delete:
                raise EditError("fact_not_found", "That fact was not found.")
            if len(section.facts) >= MAX_FACTS_PER_SECTION:
                raise EditError("too_many_facts", "That section is full. Remove a fact first.")
            text = _clean(e.text)
            if not text:
                raise EditError("empty_fact", "A fact needs some text.")
            section.facts.append(
                BriefFact(
                    id=uuid.uuid4(),
                    text=text,
                    source_ids=[],
                    label="from_you",
                    pinned=e.pinned,
                    edited_by_user=True,
                )
            )
            continue
        match = next((f for f in section.facts if f.id == e.id), None)
        if match is None:
            raise EditError("fact_not_found", "That fact was not found.")
        if e.delete:
            section.facts.remove(match)
            continue
        text = _clean(e.text)
        if not text:
            raise EditError("empty_fact", "A fact needs some text.")
        if text != match.text:
            match.text = text
            match.edited_by_user = True
        match.pinned = e.pinned
    return _refresh_flags(content)


def remove_source(content: BriefContent, source_id: uuid.UUID) -> BriefContent:
    """Drop a deleted source from every fact. Researched facts left with no source are removed (an
    unsourced claim must not stay); the user's own and edited facts stay."""
    for section in content.sections:
        kept: list[BriefFact] = []
        for fact in section.facts:
            had = source_id in fact.source_ids
            fact.source_ids = [s for s in fact.source_ids if s != source_id]
            user_owned = fact.edited_by_user or fact.label == "from_you"
            if had and not fact.source_ids and not user_owned and fact.label != "suggestion":
                continue
            kept.append(fact)
        section.facts = kept
    return _refresh_flags(content)


def _is_kept(fact: BriefFact) -> bool:
    return fact.pinned or fact.edited_by_user or fact.label == "from_you"


def kept_facts(content: BriefContent) -> list[tuple[str, BriefFact]]:
    return [(s.key, f) for s in content.sections for f in s.facts if _is_kept(f)]


def protected_source_ids(content: BriefContent | None) -> set[uuid.UUID]:
    """Sources cited by facts the user pinned or edited. A refresh must not delete these."""
    if content is None:
        return set()
    return {sid for _, f in kept_facts(content) for sid in f.source_ids}


def carry_over(old: BriefContent | None, new: BriefContent) -> BriefContent:
    """A refresh replaces the researched facts but keeps what the user did: pinned and edited facts
    and facts they added. A researched fact the user edited replaces its fresh duplicate."""
    if old is None:
        return new
    sections = {s.key: s for s in new.sections}
    for key, fact in kept_facts(old):
        target = sections.get(key)
        if target is None:
            continue
        norm = fact.text.lower()
        existing = next((f for f in target.facts if f.text.lower() == norm), None)
        if existing is not None:
            existing.pinned = existing.pinned or fact.pinned
            existing.edited_by_user = existing.edited_by_user or fact.edited_by_user
            continue
        target.facts.append(fact)
    return _refresh_flags(new)
