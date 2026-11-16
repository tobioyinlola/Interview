import re
from collections import Counter

from app.config import Settings
from evals.data import DETECTION, GROUNDING_QUESTIONS, NON_QUESTIONS, NOTE_SETS, QUESTIONS
from evals.run import run_detection, run_grounding
from tests.helpers import AnswerLlm

SETTINGS = Settings(database_url="x", cookie_secret="x")  # type: ignore[arg-type]


def test_dataset_matches_the_design_100_utterances_split_evenly():
    assert len(DETECTION) == 100
    assert sum(1 for _, q in DETECTION if q) == 50 == len(QUESTIONS)
    assert sum(1 for _, q in DETECTION if not q) == 50 == len(NON_QUESTIONS)


def test_dataset_covers_every_question_type_and_has_no_duplicates():
    kinds = Counter(k for _, k in QUESTIONS)
    for kind in ("behavioral", "technical", "situational", "company", "follow-up"):
        assert kinds[kind] >= 5, kinds
    texts = [t.lower() for t, _ in DETECTION]
    assert len(texts) == len(set(texts))


def test_non_questions_really_are_not_questions():
    for t in NON_QUESTIONS:
        assert "?" not in t, t  # a question mark would make the label ambiguous
        assert not re.match(
            r"(?i)^(tell me|describe|walk me|explain|give me|why|what|how|can you)\b", t
        ), t


def test_the_grounding_set_has_30_questions_and_3_note_sets():
    assert len(GROUNDING_QUESTIONS) == 30 and len(NOTE_SETS) == 3


class Oracle(AnswerLlm):
    """A perfect classifier: answers exactly the labelled questions."""

    def __init__(self, answer):
        super().__init__()
        self.labels = {t: q for t, q in DETECTION}
        self.answer = answer
        self.script = self._script

    def _script(self, model):
        text = self.calls[-1]["user"].rsplit("Latest interviewer turn:\n", 1)[1]
        return [self.answer] if self.labels.get(text, True) else ["NO_QUESTION"]


GOOD = "TYPE: behavioral\nPOINTS:\n- Led the 2025 checkout launch at Acme [note: Launch project]"


async def test_detection_harness_scores_a_perfect_classifier_at_100_percent():
    rep = await run_detection(Oracle(GOOD), SETTINGS)
    assert (rep.correct, rep.total) == (100, 100) and rep.passed and rep.misses == []


async def test_short_non_questions_never_cost_a_model_call():
    llm = Oracle(GOOD)
    rep = await run_detection(llm, SETTINGS)
    asked = {c["user"].rsplit("Latest interviewer turn:\n", 1)[1] for c in llm.calls}
    assert "Mm-hm, right." not in asked and "Uh-huh." not in asked
    assert rep.model_calls == len(llm.calls) < 100


async def test_a_model_that_answers_everything_fails_detection():
    llm = AnswerLlm(lambda m: [GOOD])
    rep = await run_detection(llm, SETTINGS)
    assert not rep.passed and 0.5 <= rep.score < 0.9
    assert any(m.startswith("should skip") for m in rep.misses)


async def test_a_model_that_skips_everything_fails_detection():
    rep = await run_detection(AnswerLlm(lambda m: ["NO_QUESTION"]), SETTINGS)
    assert not rep.passed and rep.score <= 0.5


class Quoting(AnswerLlm):
    def __init__(self):
        super().__init__()
        self.script = self._script

    def _script(self, model):
        notes = self.calls[-1]["user"].split("<notes>\n", 1)[1].split("\n</notes>", 1)[0]
        line = next(ln for ln in notes.splitlines() if not ln.startswith("#"))
        sentence = line.split(". ")[0].rstrip(".")
        return [f"TYPE: other\nPOINTS:\n- {sentence} [note: Notes]"]


async def test_grounding_harness_passes_outlines_that_stay_inside_each_note_set():
    rep = await run_grounding(Quoting(), SETTINGS)
    assert (
        rep.total == 180 and rep.model_calls == 180
    )  # 30 questions x 3 note sets x 2 (brief or not)
    assert rep.passed and rep.misses == []
    assert len(rep.samples) == 36  # a person reviews 20%
    assert "PASS" in rep.render()


async def test_grounding_harness_catches_an_outline_that_borrows_another_persons_notes():
    """The same outline is grounded for one note set and invented for the others."""
    borrowed = "TYPE: behavioral\nPOINTS:\n- Led the 2025 checkout launch at Acme [note: x]"
    rep = await run_grounding(AnswerLlm(lambda m: [borrowed]), SETTINGS)
    assert (
        rep.correct == 60 and rep.total == 180 and not rep.passed
    )  # only the 'pm' notes contain it


async def test_grounding_harness_fails_outlines_that_invent_facts():
    bad = "TYPE: behavioral\nPOINTS:\n- Grew revenue by 450% at Globex Corp [note: x]"
    rep = await run_grounding(AnswerLlm(lambda m: [bad]), SETTINGS)
    assert not rep.passed and rep.correct == 0 and rep.misses
