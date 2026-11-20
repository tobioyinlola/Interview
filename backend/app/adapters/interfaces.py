"""Provider interfaces. Every external system sits behind one of these so tests use fakes
and a provider can be swapped in one place."""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal, Protocol


class ProviderError(Exception):
    """An outside service failed. `message` is plain language and never contains user content."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ProviderNotConfigured(ProviderError):
    """A required key or setting is missing."""


@dataclass(frozen=True)
class SttEvent:
    kind: Literal["ready", "partial", "final", "error"]
    text: str = ""
    message: str = ""


class SttStream(Protocol):
    """One live transcription connection (one per audio source)."""

    async def send_audio(self, pcm16: bytes) -> None: ...

    def events(self) -> AsyncIterator[SttEvent]: ...

    async def close(self) -> None: ...


class SttProvider(Protocol):
    async def open_stream(self, *, sample_rate: int = 16000, prompt: str = "") -> SttStream:
        """`prompt` is a hint (role, company, jargon) that helps the transcriber spell them."""
        ...

    async def transcribe_segment(
        self, pcm16: bytes, *, sample_rate: int = 16000, prompt: str = ""
    ) -> str:
        """Per-utterance fallback transcription (FR-20)."""
        ...


@dataclass(frozen=True)
class LlmDelta:
    text: str = ""
    done: bool = False
    input_tokens: int = 0
    output_tokens: int = 0


class LlmProvider(Protocol):
    def stream_text(
        self, *, system: str, user: str, model: str | None = None
    ) -> AsyncIterator[LlmDelta]:
        """Stream a text answer token by token (live outlines)."""
        ...

    async def generate_json(self, *, system: str, user: str, schema: dict[str, object]) -> str:
        """Return JSON text matching `schema` (company brief, scoring)."""
        ...


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str
    published_at: str | None = None


@dataclass
class SearchResponse:
    results: list[SearchResult] = field(default_factory=list)
    tokens: int = 0


class SearchProvider(Protocol):
    async def search(
        self, query: str, *, allowed_domains: list[str] | None = None
    ) -> SearchResponse: ...
