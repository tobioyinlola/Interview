import json
import logging

import httpx
import pytest

from app.adapters.fakes import FakeLlmProvider, FakeSearchProvider, FakeSttProvider
from app.adapters.interfaces import SttEvent
from app.logging_config import JsonFormatter, scrub
from app.main import create_app


@pytest.fixture
async def client():
    app = create_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_healthz(client):
    r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert r.headers["x-request-id"]


async def test_request_id_is_echoed(client):
    r = await client.get("/healthz", headers={"x-request-id": "abc123"})
    assert r.headers["x-request-id"] == "abc123"


async def test_unknown_route_uses_error_shape(client):
    r = await client.get("/api/nope")
    assert r.status_code == 404
    err = r.json()["error"]
    assert err["code"] == "http_error"
    assert set(err) == {"code", "message", "request_id"}


async def test_cors_allows_only_web_origin(client):
    ok = await client.options(
        "/healthz",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    bad = await client.options(
        "/healthz",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers


def test_scrub_removes_content_fields_recursively():
    cleaned = scrub(
        {
            "route": "/x",
            "text": "secret",
            "nested": {"notes": "n", "ok": 1},
            "list": [{"audio": b"x", "id": 2}],
        }
    )
    assert cleaned == {"route": "/x", "nested": {"ok": 1}, "list": [{"id": 2}]}


def test_json_formatter_never_emits_content():
    record = logging.LogRecord("t", logging.INFO, __file__, 1, "msg", None, None)
    record.fields = {"session_id": "s1", "text": "what the partner said"}
    line = JsonFormatter().format(record)
    data = json.loads(line)
    assert data["session_id"] == "s1"
    assert "text" not in data
    assert "partner said" not in line


async def test_fake_stt_streams_script_after_audio():
    stt = FakeSttProvider(
        script=[SttEvent(kind="partial", text="hel"), SttEvent(kind="final", text="hello")]
    )
    stream = await stt.open_stream()
    await stream.send_audio(b"\x00" * 2048)
    await stream.send_audio(b"\x00" * 2048)
    got = []
    async for ev in stream.events():
        got.append(ev.kind)
        if len(got) == 3:
            await stream.close()
    assert got == ["ready", "partial", "final"]
    assert stream.received_bytes == 4096


async def test_fake_llm_and_search():
    llm = FakeLlmProvider(chunks=["a", "b"])
    out = [d async for d in llm.stream_text(system="s", user="u")]
    assert "".join(d.text for d in out) == "ab"
    assert out[-1].done
    search = FakeSearchProvider()
    resp = await search.search("acme news")
    assert resp.results == [] and search.queries == ["acme news"]


async def test_readyz_not_ready_without_database_or_key(client):
    # No Postgres and no OpenAI key in the test environment, so readiness must say so.
    r = await client.get("/readyz")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["openai_key"] is False
