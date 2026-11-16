"""Scores a finished session's answers in the background. State lives on the session row
(`scoring_status`), so the page can leave and return, and a restart is reported as a failure the
user can retry."""

import asyncio
import json
import logging
import uuid

from pydantic import ValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.interfaces import LlmProvider, ProviderError
from app.config import Settings
from app.models import PracticeSession, Score, Utterance
from app.prompts import load_prompt
from app.repositories import UsageMeterRepo
from app.services.scoring import ScoreResult, build_user_prompt, group_answers, pace_from_timing

log = logging.getLogger("app.scoring")
TIMEOUT_SECONDS = 120


class ScoringRunner:
    def __init__(
        self,
        llm: LlmProvider,
        settings: Settings,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> None:
        self.llm = llm
        self.settings = settings
        self.sf = session_factory
        self._tasks: set[asyncio.Task[None]] = set()

    def start(self, session_id: uuid.UUID, user_id: uuid.UUID) -> None:
        task = asyncio.create_task(self._guarded(session_id, user_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def wait_idle(self) -> None:
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def fail_interrupted(self) -> int:
        """On boot: a job that was running when the process stopped will never finish."""
        async with self.sf() as db:
            res = await db.execute(
                update(PracticeSession)
                .where(PracticeSession.scoring_status == "running")
                .values(
                    scoring_status="failed",
                    scoring_error="Scoring was interrupted. Press Score to run it again.",
                )
            )
            await db.commit()
            return int(res.rowcount or 0)  # type: ignore[attr-defined]

    async def _finish(self, session_id: uuid.UUID, status: str, error: str | None = None) -> None:
        async with self.sf() as db:
            await db.execute(
                update(PracticeSession)
                .where(PracticeSession.id == session_id)
                .values(scoring_status=status, scoring_error=error)
            )
            await db.commit()

    async def _guarded(self, session_id: uuid.UUID, user_id: uuid.UUID) -> None:
        try:
            async with asyncio.timeout(TIMEOUT_SECONDS):
                await self._run(session_id, user_id)
        except TimeoutError:
            await self._finish(session_id, "failed", "Scoring took too long. Press Score to retry.")
        except ProviderError as exc:
            await self._finish(session_id, "failed", exc.message)
        except Exception as exc:  # always end in ready or failed
            log.error("scoring crashed", extra={"fields": {"error": type(exc).__name__}})
            await self._finish(session_id, "failed", "Something went wrong. Press Score to retry.")

    async def _score_one(self, system: str, user: str) -> tuple[ScoreResult, int]:
        schema = ScoreResult.model_json_schema()
        for attempt in (1, 2):
            raw = await self.llm.generate_json(system=system, user=user, schema=schema)
            tokens = getattr(self.llm, "last_tokens", 0)
            try:
                return ScoreResult.model_validate(json.loads(raw)), tokens
            except (ValueError, ValidationError):
                if attempt == 2:
                    raise ProviderError("The AI returned an unreadable score. Try again.") from None
        raise AssertionError("unreachable")

    async def _run(self, session_id: uuid.UUID, user_id: uuid.UUID) -> None:
        async with self.sf() as db:
            session = await db.get(PracticeSession, session_id)
            if session is None or session.user_id != user_id:
                return
            utts = list(
                (await db.execute(select(Utterance).where(Utterance.session_id == session_id)))
                .scalars()
                .all()
            )
            notes = session.notes_snapshot
            if (await UsageMeterRepo(db, user_id).tokens_today()) >= self.settings.cap_tokens_daily:
                await self._finish(session_id, "failed", "Daily limit reached. Try again tomorrow.")
                return

        system = load_prompt("scoring")
        results: list[tuple[object, str, str, ScoreResult, int | None]] = []
        total_tokens = 0
        for ans in group_answers(utts):
            res, tokens = await self._score_one(system, build_user_prompt(notes, ans))
            total_tokens += tokens
            results.append(
                (
                    ans.first_utterance_id,
                    ans.question,
                    ans.text,
                    res,
                    pace_from_timing(ans.words, ans.seconds),
                )
            )

        async with self.sf() as db:
            await db.execute(delete(Score).where(Score.session_id == session_id))
            for utt_id, question, text, res, measured_pace in results:
                pace = measured_pace if measured_pace is not None else res.pace
                overall = round(
                    (res.structure + res.specificity + res.impact + res.relevance + pace) / 5
                )
                db.add(
                    Score(
                        session_id=session_id,
                        utterance_id=utt_id,
                        structure=res.structure,
                        specificity=res.specificity,
                        impact=res.impact,
                        relevance=res.relevance,
                        pace=pace,
                        overall=overall,
                        fixes=res.fixes,
                        question_text=question[:2000],
                        answer_text=text[:4000],
                    )
                )
            if total_tokens:
                await UsageMeterRepo(db, user_id).add_tokens(total_tokens, 0)
            # The scores and the "ready" status are one commit, so a page that polls never sees
            # finished scores beside a job that still says "running".
            await db.execute(
                update(PracticeSession)
                .where(PracticeSession.id == session_id)
                .values(scoring_status="ready", scoring_error=None)
            )
            await db.commit()
