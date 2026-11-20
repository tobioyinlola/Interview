import uuid

import pytest

from app.services.live import CLOSE_RESTART, LiveHub


class MockWebSocket:
    def __init__(self, should_fail: bool = False):
        self.sent: list[dict] = []
        self.closed: list[int] = []
        self.should_fail = should_fail

    async def send_json(self, data: dict):
        if self.should_fail:
            raise RuntimeError("Socket disconnected")
        self.sent.append(data)

    async def close(self, code: int = 1000):
        self.closed.append(code)


@pytest.mark.asyncio
async def test_live_hub_pin_generation_and_lookup():
    hub = LiveHub()
    sid = uuid.uuid4()
    pin = hub.get_or_create_pin(sid)

    assert len(pin) == 6
    assert pin.isdigit()
    assert hub.get_or_create_pin(sid) == pin  # Idempotent

    assert hub.get_session_by_pin(pin) == sid
    # Formatted with hyphen
    formatted = f"{pin[:3]}-{pin[3:]}"
    assert hub.get_session_by_pin(formatted) == sid
    assert hub.get_session_by_pin("000000") is None


@pytest.mark.asyncio
async def test_live_hub_desktop_socket_lifecycle():
    hub = LiveHub()
    sid = uuid.uuid4()
    ws1 = MockWebSocket()
    ws2 = MockWebSocket()

    assert hub.desktop_client_count(sid) == 0

    hub.register_desktop(sid, ws1)
    hub.register_desktop(sid, ws2)
    assert hub.desktop_client_count(sid) == 2

    # Broadcast
    event = {"type": "question", "question": "What is dependency injection?"}
    await hub.broadcast_desktop(sid, event)

    assert ws1.sent == [event]
    assert ws2.sent == [event]
    assert hub.last_events[sid] == event

    hub.unregister_desktop(sid, ws1)
    assert hub.desktop_client_count(sid) == 1

    hub.unregister_desktop(sid, ws2)
    assert hub.desktop_client_count(sid) == 0


@pytest.mark.asyncio
async def test_live_hub_broadcast_handles_dropped_connection():
    hub = LiveHub()
    sid = uuid.uuid4()
    healthy_ws = MockWebSocket()
    broken_ws = MockWebSocket(should_fail=True)

    hub.register_desktop(sid, healthy_ws)
    hub.register_desktop(sid, broken_ws)
    assert hub.desktop_client_count(sid) == 2

    # When broadcast fails on broken_ws, it should be automatically unregistered
    await hub.broadcast_desktop(sid, {"type": "delta", "text": "Hello"})
    assert hub.desktop_client_count(sid) == 1
    assert healthy_ws.sent == [{"type": "delta", "text": "Hello"}]


@pytest.mark.asyncio
async def test_live_hub_shutdown_closes_desktop_sockets():
    hub = LiveHub()
    sid = uuid.uuid4()
    ws = MockWebSocket()

    hub.register_desktop(sid, ws)
    await hub.shutdown()

    assert ws.closed == [CLOSE_RESTART]
    assert hub.desktop_client_count(sid) == 0
