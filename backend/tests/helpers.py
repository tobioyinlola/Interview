"""Shared fakes for tests: a fetcher with canned pages, a scripted model, a failing search."""

import json

from app.services.fetcher import FetchResult

PAGE = "Acme builds payment software for restaurants. " * 5


class FakeFetcher:
    def __init__(self, results=None):
        self.results = results or {}
        self.calls: list[str] = []

    async def fetch(self, url):
        self.calls.append(url)
        return self.results.get(url) or FetchResult(url, "blocked", "The site blocked the request.")


def ok(url, text=PAGE, title="Page"):
    return FetchResult(url, "ok", title=title, text=text, final_url=url)


class ScriptedLlm:
    """Answers with whatever `reply(user_prompt)` returns; records every prompt it saw."""

    def __init__(self, reply):
        self.reply = reply
        self.prompts: list[str] = []

    async def generate_json(self, *, system, user, schema):
        self.prompts.append(user)
        out = self.reply(user)
        if isinstance(out, Exception):
            raise out
        return out if isinstance(out, str) else json.dumps(out)

    def stream_text(self, **kw):  # pragma: no cover - not used here
        raise NotImplementedError


def good_reply(user):
    return {
        "assumed_company": None,
        "snapshot": [{"text": "Acme builds payment software.", "source_ids": [1]}],
        "likely_questions": [{"text": "Why Acme?", "source_ids": []}],
    }


class ErrSearch:
    def __init__(self, exc):
        self.exc = exc

    async def search(self, query, *, allowed_domains=None):
        raise self.exc


# ------------------------------------------------------------------ live-session fakes
import asyncio  # noqa: E402
from collections.abc import AsyncIterator, Callable  # noqa: E402

from app.adapters.interfaces import LlmDelta, ProviderError, SttEvent  # noqa: E402


class ControlledStreamError(Exception):
    pass


class ControlledStream:
    """An upstream transcription stream the test drives by hand."""

    def __init__(self, stall: bool = False) -> None:
        self.received = bytearray()
        self.closed = False
        self.stall = stall
        self._queue: asyncio.Queue[SttEvent | None] = asyncio.Queue()

    async def send_audio(self, pcm16: bytes) -> None:
        if self.stall:
            await asyncio.sleep(3600)  # a provider that stopped reading
        self.received.extend(pcm16)

    def emit(self, kind: str, text: str = "", message: str = "") -> None:
        self._queue.put_nowait(SttEvent(kind=kind, text=text, message=message))  # type: ignore[arg-type]

    async def events(self) -> AsyncIterator[SttEvent]:
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event

    async def close(self) -> None:
        self.closed = True
        self._queue.put_nowait(None)


class ControlledStt:
    def __init__(self) -> None:
        self.streams: list[ControlledStream] = []
        self.fail_opens = 0  # fail this many open attempts first
        self.error: Exception | None = None
        self.stall = False
        self.segment_text = "a fallback caption"
        self.segment_error: Exception | None = None
        self.segments: list[tuple[int, int]] = []  # (bytes, sample_rate) received
        self.prompts: list[str] = []  # the vocabulary hint each call carried

    async def open_stream(self, *, sample_rate: int = 24000, prompt: str = "") -> ControlledStream:
        self.prompts.append(prompt)
        if self.error is not None:
            raise self.error
        if self.fail_opens > 0:
            self.fail_opens -= 1
            raise ProviderError("down")
        stream = ControlledStream(stall=self.stall)
        self.streams.append(stream)
        return stream

    async def transcribe_segment(
        self, pcm16: bytes, *, sample_rate: int = 24000, prompt: str = ""
    ) -> str:
        self.prompts.append(prompt)
        self.segments.append((len(pcm16), sample_rate))
        if self.segment_error is not None:
            raise self.segment_error
        return self.segment_text

    async def stream(self, n: int = 0, timeout: float = 3.0) -> ControlledStream:
        """Wait until the n-th upstream stream has been opened."""
        async with asyncio.timeout(timeout):
            while len(self.streams) <= n:
                await asyncio.sleep(0.01)
        return self.streams[n]


class AnswerLlm:
    """Streams scripted answers. `script(model)` returns steps: a str is a text delta, a float is a
    pause in seconds, an Exception is raised. Records prompts, models and cancellation."""

    def __init__(self, script: Callable[[str | None], list] | None = None) -> None:
        self.script = script or (lambda model: list(GOOD_OUTLINE_CHUNKS))
        self.calls: list[dict] = []
        self.cancelled = 0
        self.finished = 0

    async def stream_text(
        self, *, system: str, user: str, model: str | None = None
    ) -> AsyncIterator[LlmDelta]:
        self.calls.append({"system": system, "user": user, "model": model})
        try:
            for step in self.script(model):
                if isinstance(step, Exception):
                    raise step
                if isinstance(step, float):
                    await asyncio.sleep(step)
                    continue
                yield LlmDelta(text=step)
            yield LlmDelta(done=True, input_tokens=120, output_tokens=40)
            self.finished += 1
        except (asyncio.CancelledError, GeneratorExit):
            self.cancelled += 1
            raise

    async def generate_json(self, **kw) -> str:  # pragma: no cover
        return "{}"


GOOD_OUTLINE = (
    "TYPE: behavioral\n"
    "OPENER: Let me share a launch I led.\n"
    "POINTS:\n"
    "- Led the 2025 launch with a team of 6 [note: Launch project]\n"
    "- Cut onboarding time by 30% [note: Launch project]\n"
    "CLOSE: It taught me to align people early."
)
GOOD_OUTLINE_CHUNKS = [GOOD_OUTLINE[i : i + 12] for i in range(0, len(GOOD_OUTLINE), 12)]
NOTES = (
    "## Launch project\nLed the 2025 launch with a team of 6. Cut onboarding time by 30%.\n"
    "## Tools\nPython, SQL."
)
