"""In-memory fakes used by tests (and local development without an OpenAI key)."""

import asyncio
from collections.abc import AsyncIterator

from app.adapters.interfaces import (
    LlmDelta,
    SearchResponse,
    SearchResult,
    SttEvent,
)


class FakeSttStream:
    """Emits a scripted sequence of events once audio starts arriving."""

    def __init__(self, script: list[SttEvent]) -> None:
        self._script = script
        self._queue: asyncio.Queue[SttEvent | None] = asyncio.Queue()
        self.received_bytes = 0
        self.closed = False
        self._queue.put_nowait(SttEvent(kind="ready"))

    async def send_audio(self, pcm16: bytes) -> None:
        self.received_bytes += len(pcm16)
        if self._script:
            self._queue.put_nowait(self._script.pop(0))

    async def events(self) -> AsyncIterator[SttEvent]:
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event

    async def close(self) -> None:
        self.closed = True
        self._queue.put_nowait(None)


class FakeSttProvider:
    def __init__(self, script: list[SttEvent] | None = None, segment_text: str = "fake") -> None:
        self.script = script or []
        self.segment_text = segment_text
        self.streams: list[FakeSttStream] = []

    async def open_stream(self, *, sample_rate: int = 16000) -> FakeSttStream:
        stream = FakeSttStream(list(self.script))
        self.streams.append(stream)
        return stream

    async def transcribe_segment(self, pcm16: bytes, *, sample_rate: int = 16000) -> str:
        return self.segment_text


class FakeLlmProvider:
    def __init__(self, chunks: list[str] | None = None, json_reply: str = "{}") -> None:
        self.chunks = chunks if chunks is not None else ["Hello", " world"]
        self.json_reply = json_reply
        self.calls: list[dict[str, str]] = []

    async def stream_text(
        self, *, system: str, user: str, model: str | None = None
    ) -> AsyncIterator[LlmDelta]:
        self.calls.append({"system": system, "user": user, "model": model or ""})
        for chunk in self.chunks:
            yield LlmDelta(text=chunk)
        yield LlmDelta(done=True, input_tokens=len(user), output_tokens=len(self.chunks))

    async def generate_json(self, *, system: str, user: str, schema: dict[str, object]) -> str:
        self.calls.append({"system": system, "user": user, "model": ""})
        return self.json_reply


class FakeSearchProvider:
    def __init__(self, results: list[SearchResult] | None = None) -> None:
        self.results = results or []
        self.queries: list[str] = []

    async def search(
        self, query: str, *, allowed_domains: list[str] | None = None
    ) -> SearchResponse:
        self.queries.append(query)
        return SearchResponse(results=list(self.results))


class ScriptedStt:
    """Fake-provider mode: emits a scripted caption for every `seconds_per_line` of audio heard,
    first as growing partials, then as a final. Lets the whole live path run with no OpenAI."""

    def __init__(
        self, lines: list[str], *, seconds_per_line: float = 2.0, rate: int = 24000
    ) -> None:
        self.lines = lines
        self.bytes_per_line = int(seconds_per_line * rate * 2)
        self.opened = 0

    async def open_stream(self, *, sample_rate: int = 24000) -> "ScriptedSttStream":
        self.opened += 1
        return ScriptedSttStream(self.lines, self.bytes_per_line)

    async def transcribe_segment(self, pcm16: bytes, *, sample_rate: int = 24000) -> str:
        return self.lines[0] if self.lines else ""


class ScriptedSttStream:
    def __init__(self, lines: list[str], bytes_per_line: int) -> None:
        self._lines = list(lines)
        self._per = max(1, bytes_per_line)
        self._heard = 0
        self._line = 0
        self._sent_partial = False
        self._queue: asyncio.Queue[SttEvent | None] = asyncio.Queue()

    async def send_audio(self, pcm16: bytes) -> None:
        self._heard += len(pcm16)
        if self._line >= len(self._lines):
            return
        text = self._lines[self._line]
        if not self._sent_partial and self._heard >= self._per // 2:
            self._sent_partial = True
            self._queue.put_nowait(SttEvent(kind="partial", text=" ".join(text.split()[:3])))
        if self._heard >= self._per:
            self._heard = 0
            self._sent_partial = False
            self._line += 1
            self._queue.put_nowait(SttEvent(kind="final", text=text))

    async def events(self) -> AsyncIterator[SttEvent]:
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event

    async def close(self) -> None:
        self._queue.put_nowait(None)


class ScriptedAnswerLlm:
    """Fake-provider mode: streams a well-formed outline word by word with a small delay."""

    def __init__(self, delay: float = 0.03) -> None:
        self.delay = delay

    async def stream_text(
        self, *, system: str, user: str, model: str | None = None
    ) -> AsyncIterator[LlmDelta]:
        text = (
            "TYPE: behavioral\nOPENER: Here's a project where I took the lead.\n"
            "POINTS:\n- Led a team to ship a launch on time [note: Led launch]\n"
            "- Cut onboarding time by 30% [note: Led launch]\n"
            "CLOSE: That experience taught me how to align people quickly."
        )
        for word in text.split(" "):
            await asyncio.sleep(self.delay)
            yield LlmDelta(text=word + " ")
        yield LlmDelta(done=True, input_tokens=len(user) // 4, output_tokens=len(text) // 4)

    async def generate_json(self, *, system: str, user: str, schema: dict[str, object]) -> str:
        return "{}"
