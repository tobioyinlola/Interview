"""Evaluation harness. Re-run whenever a prompt or a model changes (design: AI behaviour).

    python -m evals.run detection [--model NAME]
    python -m evals.run grounding [--model NAME]

Needs a valid OPENAI_API_KEY. `--fake` runs the harness against the scripted fake model, only to
check the plumbing (the fake is not expected to pass).

Detection passes at 90% or more correct. Grounding passes when 95% or more of outlines contain no
number or name absent from the notes and brief; a sample is printed for a person to review."""

import argparse
import asyncio
import random
import sys
import time
from dataclasses import dataclass, field

from app.adapters.fakes import ScriptedAnswerLlm
from app.adapters.interfaces import LlmProvider
from app.config import Settings, get_settings
from app.prompts import load_prompt
from app.services import grounding
from app.services.suggest import Context, SuggestionService, is_prefiltered
from evals.data import BRIEF, DETECTION, GROUNDING_QUESTIONS, NOTE_SETS, SAMPLE_ROLE

DETECTION_PASS = 0.90
GROUNDING_PASS = 0.95


@dataclass
class Report:
    name: str
    total: int = 0
    correct: int = 0
    threshold: float = 0.0
    misses: list[str] = field(default_factory=list)
    samples: list[str] = field(default_factory=list)
    model_calls: int = 0

    @property
    def score(self) -> float:
        return self.correct / self.total if self.total else 0.0

    @property
    def passed(self) -> bool:
        return self.score >= self.threshold

    def render(self) -> str:
        lines = [
            f"{self.name}: {self.correct}/{self.total} = {self.score:.1%} "
            f"(pass at {self.threshold:.0%}) -> {'PASS' if self.passed else 'FAIL'}; "
            f"{self.model_calls} model calls",
        ]
        lines += [f"  miss: {m}" for m in self.misses[:20]]
        if self.samples:
            lines.append("  sample for human review:")
            lines += [f"    {s}" for s in self.samples]
        return "\n".join(lines)


def _ctx(notes: str, brief: str) -> Context:
    return Context(role=SAMPLE_ROLE, notes=notes, brief=brief, allowed=[notes, brief, SAMPLE_ROLE])


async def _answer(
    svc: SuggestionService, llm: LlmProvider, ctx: Context, question: str
) -> tuple[bool, str]:
    """Run one turn through the same prompt and NO_QUESTION logic the live path uses.
    Returns (answered, text)."""
    prompt = svc.build_prompt(ctx, [], question)
    stream = llm.stream_text(system=load_prompt("suggestion"), user=prompt)
    text, skipped = "", False
    try:
        async for kind, payload in svc._consume(stream, time.monotonic()):
            if kind == "delta":
                text += payload
            elif kind == "skip":
                skipped = True
    finally:
        await stream.aclose()  # type: ignore[attr-defined]
    return (not skipped), text


async def run_detection(llm: LlmProvider, settings: Settings) -> Report:
    svc = SuggestionService(llm, settings, None)  # type: ignore[arg-type]
    ctx = _ctx(NOTE_SETS["pm"], "")
    rep = Report("question detection", threshold=DETECTION_PASS)
    for text, is_question in DETECTION:
        rep.total += 1
        if is_prefiltered(text, settings.suggest_prefilter_min_words):
            answered = False  # as in the live path: too short to be a question
        else:
            rep.model_calls += 1
            answered, _ = await _answer(svc, llm, ctx, text)
        if answered == is_question:
            rep.correct += 1
        else:
            rep.misses.append(f"{'should answer' if is_question else 'should skip'}: {text!r}")
    return rep


async def run_grounding(llm: LlmProvider, settings: Settings, seed: int = 7) -> Report:
    """30 questions against 3 note sets, with and without a brief. An outline passes when it
    contains no invented number or name."""
    svc = SuggestionService(llm, settings, None)  # type: ignore[arg-type]
    rep = Report("outline grounding", threshold=GROUNDING_PASS)
    outlines: list[str] = []
    for notes in NOTE_SETS.values():
        for brief in ("", BRIEF):
            ctx = _ctx(notes, brief)
            for q in GROUNDING_QUESTIONS:
                rep.model_calls += 1
                answered, text = await _answer(svc, llm, ctx, q)
                if not answered:
                    continue  # nothing shown, nothing invented
                rep.total += 1
                flags = grounding.check_outline(text, [*ctx.allowed, q])
                if flags:
                    rep.misses.append(f"{q!r} -> {flags[0]!r}")
                else:
                    rep.correct += 1
                outlines.append(f"Q: {q}\n    {text.strip()[:400]}")
    random.Random(seed).shuffle(outlines)
    rep.samples = outlines[: max(1, len(outlines) // 5)]  # a person reviews 20%
    return rep


def build_llm(settings: Settings, model: str | None, fake: bool) -> LlmProvider:
    if fake:
        return ScriptedAnswerLlm(delay=0)
    key = settings.openai_api_key.get_secret_value()
    if not key:
        sys.exit(
            "OPENAI_API_KEY is not set. Evaluations call the real model; use --fake only to test the harness."
        )
    from app.adapters.openai_provider import OpenAILlm, make_client

    return OpenAILlm(
        make_client(key),
        answer_model=model or settings.openai_answer_model,
        research_model=settings.openai_research_model,
    )


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("which", choices=["detection", "grounding"])
    ap.add_argument("--model")
    ap.add_argument("--fake", action="store_true")
    args = ap.parse_args()
    settings = get_settings()
    llm = build_llm(settings, args.model, args.fake)
    run = run_detection if args.which == "detection" else run_grounding
    report = await run(llm, settings)
    print(report.render())
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
