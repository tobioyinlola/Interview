"""Live audio relay: browser audio in, captions out.

Audio is relayed to the speech provider and discarded: nothing here writes audio anywhere. Only
finished utterances (text) are saved. The relay is a thin pipe so the 3 s latency budget is spent on
the model, not on us: every hop streams, saving never delays a caption, and a stalled upstream is
cut off after 5 s of buffered audio instead of falling further behind."""

import asyncio
import contextlib
import json
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.interfaces import ProviderError, ProviderNotConfigured, SttProvider, SttStream
from app.config import Settings
from app.repositories import AudioTokenRepo, LiveRepo, UsageMeterRepo

log = logging.getLogger("app.live")

CLOSE_NORMAL = 1000
CLOSE_RESTART = 1012
CLOSE_BAD_TOKEN = 4401
CLOSE_CAP = 4429
CLOSE_UPSTREAM = 4500
BYTES_PER_SAMPLE = 2  # 16-bit mono PCM


class SeqCounters:
    """Utterance numbers for each session, assigned the moment an utterance finishes. A restarted
    relay continues from the database. If two replicas ever number the same utterance, the unique
    (session, seq) constraint keeps the first and the second write is a harmless no-op."""

    def __init__(self) -> None:
        self._next: dict[uuid.UUID, int] = {}
        self._lock = asyncio.Lock()

    async def take(self, session_id: uuid.UUID, seed: Any) -> int:
        async with self._lock:
            if session_id not in self._next:
                self._next[session_id] = await seed() + 1
            n = self._next[session_id]
            self._next[session_id] = n + 1
            return n


class LiveHub:
    """Process-wide state: sequence counters and the open sockets (closed with 1012 on shutdown)."""

    def __init__(self) -> None:
        self.seq = SeqCounters()
        self.sockets: set[WebSocket] = set()

    async def shutdown(self) -> None:
        for ws in list(self.sockets):
            with contextlib.suppress(Exception):
                await ws.close(code=CLOSE_RESTART)
        self.sockets.clear()


class AudioRelay:
    def __init__(
        self,
        ws: WebSocket,
        *,
        session_id: uuid.UUID,
        speaker: str,
        settings: Settings,
        stt: SttProvider,
        session_factory: async_sessionmaker[AsyncSession],
        hub: LiveHub,
    ) -> None:
        self.ws = ws
        self.session_id = session_id
        self.speaker = speaker
        self.cfg = settings
        self.stt = stt
        self.sf = session_factory
        self.hub = hub
        self.user_id: uuid.UUID | None = None
        self._close_code = CLOSE_NORMAL
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._queued_bytes = 0
        self._sent_seconds = 0.0
        self._flushed_seconds = 0
        self._base_seconds = 0
        self._last_pong = time.monotonic()
        self._saves: set[asyncio.Task[None]] = set()
        self._utt_started: datetime | None = None
        self._stream: SttStream | None = None

    # ------------------------------------------------------------------ helpers

    async def _send(self, payload: dict[str, Any]) -> None:
        with contextlib.suppress(Exception):
            await self.ws.send_json(payload)

    async def _fail(self, code: int, event_code: str, message: str) -> None:
        self._close_code = code
        await self._send({"type": "error", "code": event_code, "message": message})

    # --------------------------------------------------------------------- run

    async def run(self) -> None:
        """Handle one accepted socket from the first message to the close."""
        self.hub.sockets.add(self.ws)
        try:
            if not await self._authenticate():
                return
            if not await self._open_upstream():
                return
            await self._send({"type": "ready", "sample_rate": self.cfg.stt_sample_rate})
            tasks = [
                asyncio.create_task(self._pump_client()),
                asyncio.create_task(self._pump_upstream()),
                asyncio.create_task(self._pump_audio()),
                asyncio.create_task(self._keepalive()),
                asyncio.create_task(self._meter()),
            ]
            try:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for t in tasks:
                    t.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            await self._cleanup()

    async def _authenticate(self) -> bool:
        """First message must be {"type":"auth","token":...} within 5 s. The token is single-use,
        bound to this session, and never appears in a URL or a log."""
        try:
            msg = await asyncio.wait_for(
                self.ws.receive_json(), timeout=self.cfg.audio_auth_timeout_seconds
            )
        except (TimeoutError, WebSocketDisconnect, ValueError, KeyError, RuntimeError):
            self._close_code = CLOSE_BAD_TOKEN
            return False
        token = msg.get("token") if isinstance(msg, dict) and msg.get("type") == "auth" else None
        if not isinstance(token, str):
            self._close_code = CLOSE_BAD_TOKEN
            return False
        async with self.sf() as db:
            secret = self.cfg.cookie_secret.get_secret_value()
            user_id = await AudioTokenRepo(db, secret).consume(token, self.session_id)
            if user_id is None:
                self._close_code = CLOSE_BAD_TOKEN
                return False
            if await LiveRepo(db, user_id).active_session(self.session_id) is None:
                await self._fail(CLOSE_BAD_TOKEN, "session_not_active", "This session has ended.")
                return False
            self._base_seconds = await UsageMeterRepo(db, user_id).stt_seconds_today()
        self.user_id = user_id
        if self._base_seconds >= self.cfg.cap_stt_seconds_daily:
            await self._send({"type": "cap"})
            self._close_code = CLOSE_CAP
            return False
        return True

    async def _open_upstream(self) -> bool:
        for attempt in (1, 2):
            try:
                async with asyncio.timeout(5):
                    self._stream = await self.stt.open_stream(sample_rate=self.cfg.stt_sample_rate)
                return True
            except ProviderNotConfigured as exc:
                await self._fail(CLOSE_UPSTREAM, "not_configured", exc.message)
                return False
            except (ProviderError, TimeoutError):
                if attempt == 2:
                    await self._fail(
                        CLOSE_UPSTREAM,
                        "upstream_unavailable",
                        "Transcription is unavailable. You can type the question instead.",
                    )
                    return False
        return False

    # ----------------------------------------------------------------- pumps

    async def _pump_client(self) -> None:
        """Browser to relay. Binary frames are audio; text frames are pong or stop."""
        limit = int(self.cfg.relay_buffer_seconds * self.cfg.stt_sample_rate * BYTES_PER_SAMPLE)
        while True:
            try:
                msg = await self.ws.receive()
            except (WebSocketDisconnect, RuntimeError):
                return
            if msg["type"] == "websocket.disconnect":
                return
            if (data := msg.get("bytes")) is not None:
                if self._queued_bytes + len(data) > limit:  # upstream stalled: cut, don't lag
                    await self._fail(
                        CLOSE_UPSTREAM, "upstream_slow", "Transcription fell behind. Reconnecting."
                    )
                    return
                self._queued_bytes += len(data)
                self._queue.put_nowait(data)
            elif (text := msg.get("text")) is not None:
                try:
                    kind = json.loads(text).get("type")
                except (ValueError, AttributeError):
                    continue
                if kind == "pong":
                    self._last_pong = time.monotonic()
                elif kind == "stop":
                    return

    async def _pump_audio(self) -> None:
        """Relay to provider. Counts audio seconds for the usage cap; stores nothing."""
        assert self._stream is not None
        while True:
            data = await self._queue.get()
            if data is None:
                return
            try:
                await self._stream.send_audio(data)
            except Exception as exc:
                log.warning("stt send failed", extra={"fields": {"error": type(exc).__name__}})
                await self._fail(CLOSE_UPSTREAM, "upstream_error", "Transcription was interrupted.")
                return
            self._queued_bytes -= len(data)
            self._sent_seconds += len(data) / (BYTES_PER_SAMPLE * self.cfg.stt_sample_rate)

    async def _pump_upstream(self) -> None:
        """Provider to browser. Captions go out first; saving happens beside, never before."""
        assert self._stream is not None
        async for event in self._stream.events():
            if event.kind == "partial":
                if self._utt_started is None:
                    self._utt_started = datetime.now(UTC)
                await self._send({"type": "partial", "speaker": self.speaker, "text": event.text})
            elif event.kind == "final":
                text = event.text.strip()
                started, self._utt_started = self._utt_started, None
                if not text:
                    continue
                assert self.user_id is not None
                user_id = self.user_id
                seq = await self.hub.seq.take(self.session_id, self._seed_seq)
                utterance_id = uuid.uuid4()  # announced now, saved beside the caption
                ended = datetime.now(UTC)
                await self._send(
                    {
                        "type": "final",
                        "id": str(utterance_id),
                        "speaker": self.speaker,
                        "text": text,
                        "seq": seq,
                        "ended_at": ended.isoformat(),
                    }
                )
                task = asyncio.create_task(
                    self._save(user_id, utterance_id, seq, text, started, ended)
                )
                self._saves.add(task)
                task.add_done_callback(self._saves.discard)
            elif event.kind == "error":
                await self._fail(
                    CLOSE_UPSTREAM, "upstream_error", event.message or "Transcription failed."
                )
                return

    async def _seed_seq(self) -> int:
        assert self.user_id is not None
        async with self.sf() as db:
            return await LiveRepo(db, self.user_id).max_seq(self.session_id)

    async def _save(
        self,
        user_id: uuid.UUID,
        utterance_id: uuid.UUID,
        seq: int,
        text: str,
        started: datetime | None,
        ended: datetime,
    ) -> None:
        for attempt in range(4):  # a brief database outage must not lose the utterance
            try:
                async with self.sf() as db:
                    await LiveRepo(db, user_id).save_utterance(
                        self.session_id,
                        seq=seq,
                        speaker=self.speaker,
                        text=text,
                        started_at=started,
                        ended_at=ended,
                        utterance_id=utterance_id,
                    )
                return
            except Exception as exc:
                log.warning(
                    "utterance save failed", extra={"fields": {"error": type(exc).__name__}}
                )
                await asyncio.sleep(0.5 * (2**attempt))

    async def _keepalive(self) -> None:
        """Server pings every 15 s; a missed pong closes the socket so the client reconnects."""
        interval = self.cfg.ws_ping_seconds
        while True:
            await asyncio.sleep(interval)
            if time.monotonic() - self._last_pong > 2 * interval:
                self._close_code = CLOSE_UPSTREAM
                return
            await self._send({"type": "ping"})

    async def _meter(self) -> None:
        """Count audio seconds against the daily cap. Flush in batches (one upsert every few
        seconds) and stop the session as soon as the cap is reached."""
        assert self.user_id is not None
        while True:
            await asyncio.sleep(self.cfg.usage_flush_seconds)
            total = await self._flush_usage()
            if total >= self.cfg.cap_stt_seconds_daily:
                await self._send({"type": "cap"})
                self._close_code = CLOSE_CAP
                return

    async def _flush_usage(self) -> int:
        assert self.user_id is not None
        delta = int(self._sent_seconds) - self._flushed_seconds
        async with self.sf() as db:
            meter = UsageMeterRepo(db, self.user_id)
            total = (
                await meter.add_stt_seconds(delta) if delta > 0 else await meter.stt_seconds_today()
            )
        self._flushed_seconds += max(delta, 0)
        return total

    async def _cleanup(self) -> None:
        self.hub.sockets.discard(self.ws)
        if self.user_id is not None:
            with contextlib.suppress(Exception):
                await self._flush_usage()
        if self._stream is not None:
            with contextlib.suppress(Exception):
                await self._stream.close()
        if self._saves:  # let in-flight saves finish so no finished utterance is lost
            await asyncio.gather(*list(self._saves), return_exceptions=True)
        with contextlib.suppress(Exception):
            await self.ws.close(code=self._close_code)
