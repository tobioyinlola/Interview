import json

import pytest
import websockets

from app.adapters.interfaces import ProviderError, ProviderNotConfigured
from app.adapters.openai_realtime import (
    EventParser,
    OpenAIRealtimeStt,
    UnconfiguredStt,
    session_config,
)

DELTA = "conversation.item.input_audio_transcription.delta"
DONE = "conversation.item.input_audio_transcription.completed"


def test_parser_accumulates_deltas_so_partial_is_the_whole_utterance_so_far():
    p = EventParser()
    a = p.parse({"type": DELTA, "item_id": "i1", "delta": "Tell me"})
    b = p.parse({"type": DELTA, "item_id": "i1", "delta": " about"})
    c = p.parse({"type": DONE, "item_id": "i1", "transcript": " Tell me about X. "})
    assert (a.kind, a.text) == ("partial", "Tell me")
    assert (b.kind, b.text) == ("partial", "Tell me about")
    assert (c.kind, c.text) == ("final", "Tell me about X.")


def test_parser_keeps_items_separate_and_forgets_finished_ones():
    p = EventParser()
    p.parse({"type": DELTA, "item_id": "a", "delta": "one"})
    assert p.parse({"type": DELTA, "item_id": "b", "delta": "two"}).text == "two"
    p.parse({"type": DONE, "item_id": "a", "transcript": "one"})
    assert p.parse({"type": DELTA, "item_id": "a", "delta": "new"}).text == "new"


def test_parser_error_message_never_leaks_provider_detail():
    e = EventParser().parse({"type": "error", "error": {"code": "x", "message": "secret org id"}})
    assert e.kind == "error" and "secret" not in e.message


@pytest.mark.parametrize("kind", ["session.created", "input_audio_buffer.speech_started", "x"])
def test_parser_ignores_other_events(kind):
    assert EventParser().parse({"type": kind}) is None


def test_session_config_shapes():
    beta = session_config("beta", "gpt-4o-transcribe", 24000)
    assert beta["type"] == "transcription_session.update"
    assert beta["session"]["input_audio_format"] == "pcm16"
    assert beta["session"]["input_audio_transcription"]["model"] == "gpt-4o-transcribe"
    ga = session_config("ga", "m", 24000)
    assert ga["type"] == "session.update" and ga["session"]["type"] == "transcription"
    assert ga["session"]["audio"]["input"]["format"]["rate"] == 24000


class FakeRealtimeServer:
    """A local WebSocket server speaking the protocol as this adapter assumes it."""

    def __init__(self):
        self.received: list[dict] = []
        self.headers = None
        self.script: list[dict] = []

    async def handler(self, ws):
        self.headers = ws.request.headers
        async for raw in ws:
            msg = json.loads(raw)
            self.received.append(msg)
            if msg["type"] == "input_audio_buffer.append" and self.script:
                await ws.send(json.dumps(self.script.pop(0)))


@pytest.fixture
async def server():
    fake = FakeRealtimeServer()
    async with websockets.serve(fake.handler, "127.0.0.1", 0) as srv:
        fake.url = f"ws://127.0.0.1:{srv.sockets[0].getsockname()[1]}"
        yield fake


@pytest.mark.parametrize("protocol", ["beta", "ga"])
async def test_adapter_configures_the_session_sends_base64_audio_and_yields_events(
    server, protocol
):
    server.script = [
        {"type": DELTA, "item_id": "i", "delta": "Why"},
        {"type": DONE, "item_id": "i", "transcript": "Why Acme?"},
    ]
    stt = OpenAIRealtimeStt("sk-test", model="gpt-4o-transcribe", url=server.url, protocol=protocol)
    stream = await stt.open_stream(sample_rate=24000)
    await stream.send_audio(b"\x01\x02" * 100)
    await stream.send_audio(b"\x03\x04" * 100)
    got = []
    async for ev in stream.events():
        got.append((ev.kind, ev.text))
        if ev.kind == "final":
            break
    await stream.close()

    assert got == [("partial", "Why"), ("final", "Why Acme?")]
    assert server.received[0]["type"] == session_config(protocol, "x", 24000)["type"]
    appended = [m for m in server.received if m["type"] == "input_audio_buffer.append"]
    import base64

    assert base64.b64decode(appended[0]["audio"]) == b"\x01\x02" * 100
    assert server.headers["Authorization"] == "Bearer sk-test"
    assert ("OpenAI-Beta" in server.headers) == (protocol == "beta")


async def test_a_dropped_upstream_connection_becomes_an_error_event_then_ends(server):
    stt = OpenAIRealtimeStt("k", model="m", url=server.url)
    stream = await stt.open_stream()
    await stream._ws.close()  # the provider hangs up
    kinds = [ev.kind async for ev in stream.events()]
    assert kinds == ["error"]
    await stream.close()


async def test_connect_failure_is_a_plain_provider_error_with_no_detail():
    stt = OpenAIRealtimeStt("k", model="m", url="ws://127.0.0.1:1")  # nothing listens
    with pytest.raises(ProviderError) as e:
        await stt.open_stream()
    assert "127.0.0.1" not in e.value.message


async def test_missing_key_is_reported_clearly():
    with pytest.raises(ProviderNotConfigured):
        await OpenAIRealtimeStt("", model="m", url="ws://x").open_stream()
    with pytest.raises(ProviderNotConfigured):
        await UnconfiguredStt().open_stream()
