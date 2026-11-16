"""Streaming speech-to-text over the OpenAI Realtime transcription WebSocket.

UNVERIFIED AGAINST THE LIVE SERVICE. The connected key was expired and the docs host was not
reachable from the build sandbox, and public sources disagree on the exact session-configuration
event. So the wire protocol is isolated here in two small pure functions (`session_config` and
`parse_event`) and one setting (`protocol`: "beta" or "ga"). The first live run must confirm:
event names, audio format and rate, and that deltas arrive while the speaker is still talking.
Everything else about the relay is independent of these details."""

import asyncio
import base64
import contextlib
import io
import json
import logging
import wave
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx
import websockets

from app.adapters.interfaces import ProviderError, ProviderNotConfigured, SttEvent, SttStream

log = logging.getLogger("app.stt")

Connect = Callable[..., Awaitable[Any]]


def session_config(protocol: str, model: str, sample_rate: int) -> dict[str, Any]:
    """The event that configures a transcription-only session."""
    if protocol == "ga":
        return {
            "type": "session.update",
            "session": {
                "type": "transcription",
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": sample_rate},
                        "transcription": {"model": model, "language": "en"},
                        "turn_detection": {"type": "server_vad", "silence_duration_ms": 500},
                    }
                },
            },
        }
    return {
        "type": "transcription_session.update",
        "session": {
            "input_audio_format": "pcm16",
            "input_audio_transcription": {"model": model, "language": "en"},
            "turn_detection": {"type": "server_vad", "silence_duration_ms": 500},
        },
    }


class EventParser:
    """Turns provider events into SttEvents. Keeps the running text of each in-progress item so
    `partial` always carries the whole utterance so far (the browser replaces, not appends)."""

    def __init__(self) -> None:
        self._partial: dict[str, str] = {}

    def parse(self, event: dict[str, Any]) -> SttEvent | None:
        kind = event.get("type", "")
        item = str(event.get("item_id", ""))
        if kind == "conversation.item.input_audio_transcription.delta":
            text = self._partial.get(item, "") + str(event.get("delta", ""))
            self._partial[item] = text
            return SttEvent(kind="partial", text=text)
        if kind == "conversation.item.input_audio_transcription.completed":
            self._partial.pop(item, None)
            return SttEvent(kind="final", text=str(event.get("transcript", "")).strip())
        if kind == "error":
            err = event.get("error") or {}
            log.warning("stt upstream error", extra={"fields": {"code": str(err.get("code", ""))}})
            return SttEvent(kind="error", message="The transcription service reported an error.")
        return None  # session.created, speech_started, committed, rate_limits... not needed


class RealtimeStream:
    def __init__(self, ws: Any, protocol: str, model: str, sample_rate: int) -> None:
        self._ws = ws
        self._parser = EventParser()
        self._queue: asyncio.Queue[SttEvent | None] = asyncio.Queue()
        self._closed = False
        self._config = session_config(protocol, model, sample_rate)
        self._reader: asyncio.Task[None] | None = None

    async def start(self) -> None:
        await self._ws.send(json.dumps(self._config))
        self._reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        try:
            async for raw in self._ws:
                try:
                    parsed = self._parser.parse(json.loads(raw))
                except (ValueError, TypeError):
                    continue
                if parsed is not None:
                    self._queue.put_nowait(parsed)
        except websockets.ConnectionClosed:
            pass
        except Exception as exc:  # reader must never die silently
            log.warning("stt reader failed", extra={"fields": {"error": type(exc).__name__}})
        finally:
            if not self._closed:
                self._queue.put_nowait(
                    SttEvent(kind="error", message="The transcription connection closed.")
                )
            self._queue.put_nowait(None)

    async def send_audio(self, pcm16: bytes) -> None:
        msg = {"type": "input_audio_buffer.append", "audio": base64.b64encode(pcm16).decode()}
        await self._ws.send(json.dumps(msg))

    async def events(self) -> AsyncIterator[SttEvent]:
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event

    async def close(self) -> None:
        self._closed = True
        with contextlib.suppress(Exception):
            await self._ws.close()
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._reader


class OpenAIRealtimeStt:
    def __init__(
        self,
        api_key: str,
        *,
        model: str,
        url: str,
        protocol: str = "beta",
        connect: Connect | None = None,
        fallback_model: str = "gpt-4o-mini-transcribe",
        http: httpx.AsyncClient | None = None,
        api_base: str = "https://api.openai.com",
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.url = url
        self.protocol = protocol
        self._connect = connect or websockets.connect
        self.fallback_model = fallback_model
        self._http = http
        self._api_base = api_base

    async def open_stream(self, *, sample_rate: int = 24000) -> SttStream:
        if not self.api_key:
            raise ProviderNotConfigured("The OpenAI key is not configured on the server.")
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if self.protocol == "beta":
            headers["OpenAI-Beta"] = "realtime=v1"
        try:
            ws = await self._connect(self.url, additional_headers=headers, open_timeout=5)
            stream = RealtimeStream(ws, self.protocol, self.model, sample_rate)
            await stream.start()
            return stream
        except ProviderError:
            raise
        except Exception as exc:
            log.warning("stt connect failed", extra={"fields": {"error": type(exc).__name__}})
            raise ProviderError("Couldn't reach the transcription service.") from None

    async def transcribe_segment(self, pcm16: bytes, *, sample_rate: int = 24000) -> str:
        """Per-utterance fallback (FR-20): transcribe one finished speech segment as a file.
        UNVERIFIED against the live service, like the streaming path."""
        if not self.api_key:
            raise ProviderNotConfigured("The OpenAI key is not configured on the server.")
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sample_rate)
            w.writeframes(pcm16)
        client = self._http or httpx.AsyncClient(timeout=20)
        try:
            resp = await client.post(
                f"{self._api_base}/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                data={"model": self.fallback_model, "language": "en", "response_format": "json"},
                files={"file": ("segment.wav", buf.getvalue(), "audio/wav")},
            )
        except httpx.HTTPError as exc:
            log.warning(
                "segment transcription failed", extra={"fields": {"error": type(exc).__name__}}
            )
            raise ProviderError("Couldn't reach the transcription service.") from None
        finally:
            if self._http is None:
                await client.aclose()
        if resp.status_code >= 400:
            log.warning(
                "segment transcription refused", extra={"fields": {"status": resp.status_code}}
            )
            raise ProviderError("The transcription service couldn't transcribe that.")
        try:
            return str(resp.json().get("text", "")).strip()
        except ValueError:
            raise ProviderError(
                "The transcription service returned an unreadable answer."
            ) from None


class UnconfiguredStt:
    async def open_stream(self, *, sample_rate: int = 24000) -> SttStream:
        raise ProviderNotConfigured("The OpenAI key is not configured on the server.")

    async def transcribe_segment(self, pcm16: bytes, *, sample_rate: int = 24000) -> str:
        raise ProviderNotConfigured("The OpenAI key is not configured on the server.")
