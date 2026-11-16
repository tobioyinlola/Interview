"""Live answer outlines. One model call both decides whether the turn is a question and writes the
outline, so there is no classifier round trip on the latency budget. Text is streamed to the browser
the moment it arrives; nothing waits for the full answer."""

import asyncio
import contextlib
import logging
import re
import time
import uuid
from collections import OrderedDict
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.interfaces import LlmProvider, ProviderError, ProviderNotConfigured
from app.config import Settings
from app.models import CompanyBrief, CompanySource, PracticeSession, Suggestion, Utterance
from app.prompts import load_prompt
from app.repositories import LiveRepo, UsageMeterRepo
from app.schemas.brief import BriefContent
from app.services import grounding

log = logging.getLogger("app.suggest")
NOTES_CHARS = 16_000
BRIEF_CHARS = 6_000
NO_QUESTION = "NO_QUESTION"
CONTEXT_CACHE = 256


@dataclass
class Context:
    """Everything about the session that does not change between questions. Built once, kept in
    memory, rebuilt in one query by any replica that lacks it."""

    role: str
    notes: str
    brief: str  # rendered brief text, pinned facts first; "" when there is none
    allowed: list[str]


def render_brief(
    content: BriefContent, titles: dict[uuid.UUID, str], limit: int = BRIEF_CHARS
) -> str:
    """Facts only (suggestions are not facts), pinned first, each with its source name, trimmed to
    a fixed length so the prompt, and the first token, do not grow with the brief."""
    lines: list[tuple[bool, str]] = []
    for section in content.sections:
        if section.key in ("likely_questions", "questions_to_ask"):
            continue
        for fact in section.facts:
            fallback = "From you" if (fact.label == "from_you" or fact.edited_by_user) else "source"
            name = next((titles[s] for s in fact.source_ids if s in titles), fallback)
            when = f" ({fact.date})" if fact.date else ""
            lines.append((fact.pinned, f"- {section.title}: {fact.text}{when} [brief: {name}]"))
    lines.sort(key=lambda x: not x[0])  # stable: pinned first
    out, size = [], 0
    for _, line in lines:
        if size + len(line) > limit:
            break
        out.append(line)
        size += len(line) + 1
    return "\n".join(out)


def is_prefiltered(question: str, min_words: int) -> bool:
    """A very short turn with no question mark ("Mm-hm", "Right, ok") never reaches the model."""
    q = " ".join(question.split())
    return len(q.split()) < min_words and "?" not in q


class SuggestionService:
    def __init__(
        self,
        llm: LlmProvider,
        settings: Settings,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> None:
        self.llm = llm
        self.settings = settings
        self.sf = session_factory
        self._ctx: OrderedDict[uuid.UUID, Context] = OrderedDict()

    # ---------------------------------------------------------------- context

    async def context(self, db: AsyncSession, session: PracticeSession) -> Context:
        cached = self._ctx.get(session.id)
        if cached is not None:
            self._ctx.move_to_end(session.id)
            return cached
        brief_text, titles_text = "", ""
        if session.brief_id is not None:
            row = await db.get(CompanyBrief, session.brief_id)
            if row is not None:
                from sqlalchemy import select

                srcs = (
                    await db.execute(
                        select(CompanySource).where(CompanySource.company_id == row.company_id)
                    )
                ).scalars()
                titles = {s.id: (s.title or s.url or "source")[:60] for s in srcs}
                content = BriefContent.model_validate(row.content)
                brief_text = render_brief(content, titles)
                titles_text = " ".join(titles.values())
        notes = (session.notes_snapshot or "")[:NOTES_CHARS]
        ctx = Context(
            role=session.role,
            notes=notes,
            brief=brief_text,
            allowed=[notes, brief_text, titles_text, session.role],
        )
        self._ctx[session.id] = ctx
        while len(self._ctx) > CONTEXT_CACHE:
            self._ctx.popitem(last=False)
        return ctx

    def forget(self, session_id: uuid.UUID) -> None:
        self._ctx.pop(session_id, None)

    @staticmethod
    def build_prompt(ctx: Context, history: list[str], question: str) -> str:
        brief = ctx.brief or "No company brief is available."
        convo = "\n".join(history) if history else "(nothing earlier)"
        return (
            f"Target role: {ctx.role or 'not specified'}\n\n"
            f"<notes>\n{ctx.notes or 'The candidate has not written any notes.'}\n</notes>\n\n"
            f"<brief>\n{brief}\n</brief>\n\n"
            f"<conversation>\n{convo}\n</conversation>\n\n"
            f"Latest interviewer turn:\n{question}"
        )

    @staticmethod
    async def _wait_for_utterances(
        live: LiveRepo, session_id: uuid.UUID, ids: list[uuid.UUID]
    ) -> list[Utterance]:
        """The browser asks for an outline the moment a caption arrives, and the relay saves that
        utterance beside the caption, so the row may land a few milliseconds later. Wait briefly
        for it rather than losing the link between question and outline."""
        found = await live.recent_utterances(session_id, ids)
        for _ in range(10):
            if len(found) >= min(len(ids), 3):
                break
            await asyncio.sleep(0.05)
            found = await live.recent_utterances(session_id, ids)
        return found

    # ----------------------------------------------------------------- stream

    async def stream(
        self,
        *,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        question_text: str,
        utterance_ids: list[uuid.UUID],
        regenerate: bool,
    ) -> AsyncIterator[dict[str, Any]]:
        """Yields {"event": delta|skip|done|error, "data": {...}} dicts."""
        cfg = self.settings
        started = time.monotonic()
        question = " ".join(question_text.split())

        async with self.sf() as db:
            live = LiveRepo(db, user_id)
            session = await live.active_session(session_id)
            if session is None:
                yield _error(
                    "session_not_active", "This session has ended.", "Start a new session."
                )
                return
            utts = await self._wait_for_utterances(live, session_id, utterance_ids)
            utterance_id = utts[-1].id if utts else None

            # Repeats are free: return the saved outline, do not call the model again.
            saved = await live.saved_suggestion(session_id, utterance_id, question)
            if saved is not None and not regenerate:
                yield {"event": "delta", "data": {"text": saved.output_text}}
                yield _done(saved, saved.first_token_ms or 0)
                return
            if saved is not None:
                await db.execute(delete(Suggestion).where(Suggestion.id == saved.id))
                await db.commit()

            # Cheap pre-filter: a very short turn with no question mark never reaches the model.
            if is_prefiltered(question, cfg.suggest_prefilter_min_words):
                yield {"event": "skip", "data": {}}
                return

            if await UsageMeterRepo(db, user_id).tokens_today() >= cfg.cap_tokens_daily:
                yield _error("daily_cap", "Daily answer limit reached.", "Try again tomorrow.")
                return

            ctx = await self.context(db, session)
            history = [f"{u.speaker}: {u.text}" for u in utts[:-1]]
            prompt = self.build_prompt(ctx, history, question)
            system = load_prompt("suggestion")

        text, first_token_ms, usage, model = "", None, (0, 0), ""
        skipped = False
        models: list[str | None] = [None, cfg.openai_answer_fallback_model]
        for attempt, model_name in enumerate(models):
            text, first_token_ms, usage, skipped = "", None, (0, 0), False
            stream = self.llm.stream_text(system=system, user=prompt, model=model_name)
            model = model_name or cfg.openai_answer_model
            try:
                async for kind, payload in self._consume(stream, started):
                    if kind == "delta":
                        text += payload
                        if first_token_ms is None:
                            first_token_ms = int((time.monotonic() - started) * 1000)
                        yield {"event": "delta", "data": {"text": payload}}
                    elif kind == "skip":
                        skipped = True
                    elif kind == "usage":
                        usage = payload
                break
            except (TimeoutError, ProviderError) as exc:
                if isinstance(exc, ProviderNotConfigured):
                    yield _error("not_configured", exc.message, "Ask the owner to add the key.")
                    return
                if attempt == 0 and not text:
                    log.info("answer retry on fallback model")
                    continue  # nothing shown yet: retry once on the fallback model
                yield _error(
                    "answer_unavailable",
                    "The answer couldn't be written.",
                    "Ask again, or type the question below.",
                )
                return
            finally:
                with contextlib.suppress(Exception):
                    await stream.aclose()  # type: ignore[attr-defined]  # cancels the model call

        if skipped:
            yield {"event": "skip", "data": {}}
            return

        total_ms = int((time.monotonic() - started) * 1000)
        flags = grounding.check_outline(text, [*ctx.allowed, question, *[u.text for u in utts]])
        async with self.sf() as db:
            row = Suggestion(
                session_id=session_id,
                utterance_id=utterance_id,
                question_text=question,
                type=grounding.outline_type(text),
                output_text=text.strip(),
                sources_used=grounding.cited_sources(text),
                model=model,
                first_token_ms=first_token_ms,
                total_ms=total_ms,
                grounding_flags=flags,
            )
            db.add(row)
            await db.commit()
            await db.refresh(row)
            await UsageMeterRepo(db, user_id).add_tokens(*usage)
        yield _done(row, first_token_ms or 0)

    async def _consume(
        self, stream: AsyncIterator[Any], started: float
    ) -> AsyncIterator[tuple[str, Any]]:
        """Reads model output, deciding NO_QUESTION from the first few characters so nothing of a
        non-answer is ever shown, and enforcing the first-token and total deadlines."""
        cfg = self.settings
        head = ""
        decided = False
        input_tokens = output_tokens = 0
        it = stream.__aiter__()
        first = True
        while True:
            remaining = cfg.suggest_total_timeout_seconds - (time.monotonic() - started)
            if remaining <= 0:
                raise TimeoutError
            limit = min(remaining, cfg.suggest_first_token_timeout_seconds) if first else remaining
            try:
                delta = await asyncio.wait_for(it.__anext__(), timeout=limit)
            except StopAsyncIteration:
                break
            first = False
            if delta.done:
                input_tokens, output_tokens = delta.input_tokens, delta.output_tokens
                break
            if not delta.text:
                continue
            if decided:
                yield "delta", delta.text
                continue
            head += delta.text
            probe = head.lstrip()
            if len(probe) >= len(NO_QUESTION) or not NO_QUESTION.startswith(probe.upper()):
                if probe.upper().startswith(NO_QUESTION):
                    yield "skip", None
                    return
                decided = True
                yield "delta", head
        if not decided and head:  # stream ended before enough text to decide
            if head.strip().upper().startswith(NO_QUESTION):
                yield "skip", None
                return
            yield "delta", head
        yield "usage", (input_tokens, output_tokens)


def _error(code: str, message: str, next_step: str) -> dict[str, Any]:
    return {"event": "error", "data": {"code": code, "message": message, "next_step": next_step}}


def _done(row: Suggestion, first_token_ms: int) -> dict[str, Any]:
    return {
        "event": "done",
        "data": {
            "suggestion_id": str(row.id),
            "first_token_ms": first_token_ms,
            "total_ms": row.total_ms or 0,
            "grounding_flags": list(row.grounding_flags or []),
        },
    }


def parse_note_titles(notes: str) -> list[str]:  # pragma: no cover - helper for evals
    return [m.group(1) for m in re.finditer(r"^#+\s*(.+)$", notes, re.MULTILINE)]
