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
