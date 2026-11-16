"""Answer scoring. After a session, each answer the user spoke (the microphone's "you" lines) is
scored 0-100 on structure, specificity, impact, relevance and pace, with two or three fixes."""

import re
from dataclasses import dataclass

from pydantic import BaseModel, Field, field_validator

from app.models import Utterance

MIN_ANSWER_WORDS = 5
MAX_QUESTION_LINES = 3


@dataclass
class Answer:
    question: str
    text: str
    first_utterance_id: object  # uuid.UUID of the first "you" line of the answer
    words: int
    seconds: float | None


class ScoreResult(BaseModel):
    """What the model must return. Anything outside 0-100 is rejected, not clamped silently."""

    structure: int = Field(ge=0, le=100)
    specificity: int = Field(ge=0, le=100)
    impact: int = Field(ge=0, le=100)
    relevance: int = Field(ge=0, le=100)
    pace: int = Field(ge=0, le=100)
    fixes: list[str] = Field(min_length=2, max_length=3)

    @field_validator("fixes")
    @classmethod
    def _fixes(cls, v: list[str]) -> list[str]:
        out = [" ".join(f.split())[:200] for f in v if f and f.strip()]
        if not 2 <= len(out) <= 3:
            raise ValueError("two or three non-empty fixes are required")
        return out

    @property
    def overall(self) -> int:
        parts = (self.structure, self.specificity, self.impact, self.relevance, self.pace)
        return round(sum(parts) / len(parts))


def group_answers(utterances: list[Utterance]) -> list[Answer]:
    """An answer is a run of consecutive "you" lines; its question is the partner lines (up to 3)
    right before it. Runs too short to judge, or with no question before them, are skipped."""
    ordered = sorted(utterances, key=lambda u: u.seq)
    answers: list[Answer] = []
    i = 0
    while i < len(ordered):
        if ordered[i].speaker != "you":
            i += 1
            continue
        j = i
        while j < len(ordered) and ordered[j].speaker == "you":
            j += 1
        run = ordered[i:j]
        # the partner lines directly before the run (not older ones beyond a user line)
        q_lines: list[Utterance] = []
        for u in reversed(ordered[:i]):
            if u.speaker != "partner" or len(q_lines) >= MAX_QUESTION_LINES:
                break
            q_lines.insert(0, u)
        text = " ".join(u.text for u in run).strip()
        words = len(text.split())
        if q_lines and words >= MIN_ANSWER_WORDS:
            start, end = run[0].started_at, run[-1].ended_at
            seconds = (end - start).total_seconds() if start and end else None
            answers.append(
                Answer(
                    question=" ".join(u.text for u in q_lines),
                    text=text,
                    first_utterance_id=run[0].id,
                    words=words,
                    seconds=seconds,
                )
            )
        i = j
    return answers


def pace_from_timing(words: int, seconds: float | None) -> int | None:
    """Speaking pace from real timing: 110-170 words a minute is ideal (100); slower or faster
    loses points. None when there is no usable timing, so the model's text-based pace is used."""
    if seconds is None or seconds < 3 or words < 8:
        return None
    wpm = words / (seconds / 60)
    if 110 <= wpm <= 170:
        return 100
    gap = (110 - wpm) / 50 if wpm < 110 else (wpm - 170) / 60
    return max(0, round(100 - 60 * min(gap, 1.0) - (40 * max(0.0, gap - 1.0))))


def build_user_prompt(notes: str, answer: Answer) -> str:
    def clean(t: str) -> str:
        return re.sub(r"</?(question|answer|notes)>", "", t, flags=re.IGNORECASE)

    return (
        f"<notes>\n{clean(notes)[:6000] or '(no notes)'}\n</notes>\n\n"
        f"<question>\n{clean(answer.question)}\n</question>\n\n"
        f"<answer>\n{clean(answer.text)[:4000]}\n</answer>"
    )
