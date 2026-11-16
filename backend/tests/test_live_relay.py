"""The audio relay over a real WebSocket against a real server (ASGI test clients cannot do
WebSockets or client disconnects)."""

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import websockets
from sqlalchemy import func, select, update

from app.models import AudioToken, PracticeSession, Usage, User, Utterance
from app.repositories import LiveRepo
from app.services.live import LiveHub

ORIGIN = "http://localhost:5173"
FRAME = b"\x00\x01" * 1024  # 1,024 samples of 16-bit audio, as the browser sends


@pytest.fixture
async def alice(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "alice@example.com")
        yield c


async def new_session(client, **body):
    r = await client.post("/api/sessions", json={"consent": True, **body})
    assert r.status_code == 201, r.text
    return r.json()


async def connect(host, sid, speaker="partner", origin=ORIGIN):
    return await websockets.connect(
        f"ws://{host}/api/sessions/{sid}/audio?speaker={speaker}", origin=origin
    )


async def recv(ws, timeout=3.0):
    return json.loads(await asyncio.wait_for(ws.recv(), timeout))


async def open_ready(host, sid, token, speaker="partner"):
    ws = await connect(host, sid, speaker)
    await ws.send(json.dumps({"type": "auth", "token": token}))
    ready = await recv(ws)
    assert ready["type"] == "ready", ready
    return ws, ready


async def close_code(ws, timeout=3.0):
    """Drain until the server closes the socket; return the close code."""
    try:
        async with asyncio.timeout(timeout):
            while True:
                await ws.recv()
    except websockets.ConnectionClosed as e:
        return e.rcvd.code if e.rcvd else None


async def next_event(ws, kind, timeout=3.0):
    async with asyncio.timeout(timeout):
        while True:
            msg = await recv(ws, timeout)
            if msg["type"] == kind:
                return msg


async def utterances(db, session_id):
    db.expire_all()
    rows = await db.execute(
        select(Utterance)
        .where(Utterance.session_id == uuid.UUID(session_id))
        .order_by(Utterance.seq)
    )
    return rows.scalars().all()


# ------------------------------------------------------------------- happy path


async def test_audio_in_captions_out_and_utterances_saved(alice, live_server, stt, db):
    s = await new_session(alice)
    ws, ready = await open_ready(live_server, s["session_id"], s["audio_token"])
    assert ready["sample_rate"] == 24000
    up = await stt.stream()

    for _ in range(3):
        await ws.send(FRAME)
    up.emit("partial", "Tell me")
    up.emit("partial", "Tell me about a time")
    up.emit("final", "Tell me about a time you led a team?")
    up.emit("final", "  Why this company?  ")
    up.emit("final", "   ")  # empty text is ignored

    assert (await next_event(ws, "partial"))["text"] == "Tell me"
    assert (await next_event(ws, "partial"))["text"] == "Tell me about a time"
    f1 = await next_event(ws, "final")
    f2 = await next_event(ws, "final")
    assert uuid.UUID(f1["id"]) != uuid.UUID(f2["id"])
    assert (f1["seq"], f1["speaker"], f1["text"]) == (
        1,
        "partner",
        "Tell me about a time you led a team?",
    )
    assert (f2["seq"], f2["text"]) == (2, "Why this company?")
    assert datetime.fromisoformat(f1["ended_at"])

    await ws.send(json.dumps({"type": "stop"}))
    assert await close_code(ws) == 1000
    rows = await utterances(db, s["session_id"])
    assert [str(u.id) for u in rows] == [f1["id"], f2["id"]]  # the announced id is the saved id
    assert [(u.seq, u.speaker, u.text) for u in rows] == [
        (1, "partner", "Tell me about a time you led a team?"),
        (2, "partner", "Why this company?"),
    ]
    assert up.closed
    assert len(up.received) == 3 * len(FRAME)  # audio reached the provider...


async def test_no_audio_is_ever_stored(alice, live_server, stt, engine):
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    await ws.send(FRAME)
    await ws.send(json.dumps({"type": "stop"}))
    await close_code(ws)
    from sqlalchemy import inspect

    async with engine.connect() as conn:
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
        for t in tables:
            cols = await conn.run_sync(
                lambda c, t=t: [x["name"] for x in inspect(c).get_columns(t)]
            )
            assert not [c for c in cols if "audio" in c and t != "audio_tokens"], (t, cols)


async def test_numbering_continues_across_a_reconnect_and_a_new_process(
    alice, live_server, stt, db, hub, app
):
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    up = await stt.stream(0)
    up.emit("final", "first question?")
    assert (await next_event(ws, "final"))["seq"] == 1
    await ws.close()
    await asyncio.sleep(0.2)

    tok = (await alice.post(f"/api/sessions/{s['session_id']}/audio-token")).json()["audio_token"]
    ws2, _ = await open_ready(live_server, s["session_id"], tok)
    up2 = await stt.stream(1)
    up2.emit("final", "second question?")
    assert (await next_event(ws2, "final"))["seq"] == 2
    await ws2.close()
    await asyncio.sleep(0.2)

    app.dependency_overrides[__import__("app.deps", fromlist=["get_hub"]).get_hub] = lambda: (
        LiveHub()
    )
    tok = (await alice.post(f"/api/sessions/{s['session_id']}/audio-token")).json()["audio_token"]
    ws3, _ = await open_ready(live_server, s["session_id"], tok)  # a "restarted" process
    up3 = await stt.stream(2)
    up3.emit("final", "third question?")
    assert (await next_event(ws3, "final"))["seq"] == 3  # seeded from the database
    await ws3.close()
    await asyncio.sleep(0.2)
    assert [u.seq for u in await utterances(db, s["session_id"])] == [1, 2, 3]


async def test_a_saved_write_repeated_after_reconnect_is_harmless(alice, db):
    s = await new_session(alice)
    sid = uuid.UUID(s["session_id"])
    user = (await db.execute(select(User))).scalar_one()
    live = LiveRepo(db, user.id)
    now = datetime.now(UTC)
    a = await live.save_utterance(
        sid, seq=1, speaker="partner", text="x", started_at=None, ended_at=now
    )
    b = await live.save_utterance(
        sid, seq=1, speaker="partner", text="x", started_at=None, ended_at=now
    )
    assert a == b
    assert int((await db.execute(select(func.count()).select_from(Utterance))).scalar_one()) == 1


async def test_a_database_outage_never_delays_the_caption_and_the_utterance_is_kept(
    alice, live_server, stt, db, monkeypatch
):
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    up = await stt.stream()
    real = LiveRepo.save_utterance
    attempts = {"n": 0}

    async def flaky(self, *a, **kw):
        attempts["n"] += 1
        if attempts["n"] <= 2:
            raise ConnectionError("db down")
        return await real(self, *a, **kw)

    monkeypatch.setattr(LiveRepo, "save_utterance", flaky)
    up.emit("final", "Are you there?")
    assert (await next_event(ws, "final"))["text"] == "Are you there?"  # caption was not held up
    await ws.send(json.dumps({"type": "stop"}))
    await close_code(ws)
    assert [u.text for u in await utterances(db, s["session_id"])] == ["Are you there?"]
    assert attempts["n"] == 3


# -------------------------------------------------------------------- auth


async def test_token_is_single_use(alice, live_server, stt):
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    await ws.close()
    again = await connect(live_server, s["session_id"])
    await again.send(json.dumps({"type": "auth", "token": s["audio_token"]}))
    assert await close_code(again) == 4401


@pytest.mark.parametrize(
    "first",
    [
        {"type": "auth", "token": "nope"},
        {"type": "auth"},
        {"type": "auth", "token": 123},
        {"type": "hello", "token": "x"},
        ["not", "an", "object"],
    ],
)
async def test_bad_first_messages_close_with_4401(alice, live_server, first):
    s = await new_session(alice)
    ws = await connect(live_server, s["session_id"])
    await ws.send(json.dumps(first))
    assert await close_code(ws) == 4401


async def test_no_first_message_within_the_deadline_closes_4401(alice, live_server, settings):
    settings.audio_auth_timeout_seconds = 0.3
    s = await new_session(alice)
    ws = await connect(live_server, s["session_id"])
    assert await close_code(ws, timeout=2) == 4401


async def test_binary_first_message_is_rejected(alice, live_server):
    s = await new_session(alice)
    ws = await connect(live_server, s["session_id"])
    await ws.send(FRAME)
    assert await close_code(ws) == 4401


async def test_expired_token_is_rejected(alice, live_server, db):
    s = await new_session(alice)
    await db.execute(update(AudioToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    await db.commit()
    ws = await connect(live_server, s["session_id"])
    await ws.send(json.dumps({"type": "auth", "token": s["audio_token"]}))
    assert await close_code(ws) == 4401


async def test_a_token_only_works_for_its_own_session(alice, live_server):
    s1, s2 = await new_session(alice), await new_session(alice)
    ws = await connect(live_server, s2["session_id"])
    await ws.send(json.dumps({"type": "auth", "token": s1["audio_token"]}))
    assert await close_code(ws) == 4401


async def test_one_users_token_cannot_open_anothers_session(new_client, sign_in, live_server):
    async with new_client() as a, new_client() as b:
        await sign_in(a, "a@example.com")
        await sign_in(b, "b@example.com")
        sa, sb = await new_session(a), await new_session(b)
        ws = await connect(live_server, sa["session_id"])
        await ws.send(json.dumps({"type": "auth", "token": sb["audio_token"]}))
        assert await close_code(ws) == 4401


async def test_tokens_are_stored_hashed(alice, db):
    s = await new_session(alice)
    hashes = [t.token_hash for t in (await db.execute(select(AudioToken))).scalars()]
    assert s["audio_token"] not in hashes and len(hashes[0]) == 64


async def test_a_foreign_origin_is_refused_at_the_handshake(alice, live_server):
    s = await new_session(alice)
    with pytest.raises(websockets.exceptions.InvalidStatus) as e:
        await connect(live_server, s["session_id"], origin="https://evil.example")
    assert e.value.response.status_code == 403  # never upgraded: no socket exists


async def test_an_ended_session_cannot_be_streamed(alice, live_server):
    s = await new_session(alice)
    await alice.post(f"/api/sessions/{s['session_id']}/end")
    ws = await connect(live_server, s["session_id"])
    await ws.send(json.dumps({"type": "auth", "token": s["audio_token"]}))
    msg = await recv(ws)
    assert msg["type"] == "error" and msg["code"] == "session_not_active"
    assert await close_code(ws) == 4401


async def test_unknown_speaker_is_refused(alice, live_server):
    s = await new_session(alice)
    ws = await connect(live_server, s["session_id"], speaker="robot")
    assert await close_code(ws) == 4401


# ------------------------------------------------------------- failure handling


async def test_missing_provider_key_is_reported_not_crashed(alice, live_server, stt):
    from app.adapters.interfaces import ProviderNotConfigured

    stt.error = ProviderNotConfigured("The OpenAI key is not configured on the server.")
    s = await new_session(alice)
    ws = await connect(live_server, s["session_id"])
    await ws.send(json.dumps({"type": "auth", "token": s["audio_token"]}))
    msg = await recv(ws)
    assert msg["type"] == "error" and msg["code"] == "not_configured"
    assert await close_code(ws) == 4500


async def test_one_failed_open_is_retried_two_in_a_row_are_reported(alice, live_server, stt):
    stt.fail_opens = 1
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])  # retry succeeded
    await ws.close()

    stt.fail_opens = 2
    tok = (await alice.post(f"/api/sessions/{s['session_id']}/audio-token")).json()["audio_token"]
    ws2 = await connect(live_server, s["session_id"])
    await ws2.send(json.dumps({"type": "auth", "token": tok}))
    msg = await recv(ws2)
    assert msg["code"] == "upstream_unavailable" and "type the question" in msg["message"]
    assert await close_code(ws2) == 4500


async def test_upstream_error_is_forwarded_then_the_socket_closes(alice, live_server, stt):
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    (await stt.stream()).emit("error", message="The transcription service reported an error.")
    err = await next_event(ws, "error")
    assert err["code"] == "upstream_error"
    assert await close_code(ws) == 4500


async def test_a_stalled_provider_is_cut_off_after_the_buffer_limit(
    alice, live_server, stt, settings
):
    settings.relay_buffer_seconds = 0.2  # ~9,600 bytes at 24 kHz
    stt.stall = True
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    for _ in range(20):
        await ws.send(FRAME)
    err = await next_event(ws, "error")
    assert err["code"] == "upstream_slow"
    assert await close_code(ws) == 4500


async def test_server_restart_closes_open_sockets_with_1012(alice, live_server, stt, hub):
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    await hub.shutdown()
    assert await close_code(ws) == 1012


async def test_a_client_that_vanishes_releases_the_upstream(alice, live_server, stt):
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    up = await stt.stream()
    ws.transport.abort()  # no close handshake: the tab was killed
    async with asyncio.timeout(3):
        while not up.closed:
            await asyncio.sleep(0.02)


# ------------------------------------------------------------- keepalive


async def test_server_pings_and_a_responding_client_stays_connected(
    alice, live_server, stt, settings
):
    settings.ws_ping_seconds = 0.15
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    for _ in range(4):
        await next_event(ws, "ping")
        await ws.send(json.dumps({"type": "pong"}))
    up = await stt.stream()
    await ws.send(FRAME)  # still connected and relaying after several ping/pong rounds
    async with asyncio.timeout(2):
        while len(up.received) < len(FRAME):
            await asyncio.sleep(0.02)
    await ws.close()


async def test_a_missed_pong_closes_the_socket(alice, live_server, stt, settings):
    settings.ws_ping_seconds = 0.1
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    assert await close_code(ws, timeout=3) == 4500  # never answered the pings


# --------------------------------------------------------------- usage caps


async def _seconds(db):
    db.expire_all()
    return (await db.execute(select(Usage.stt_seconds))).scalar_one_or_none() or 0


async def test_audio_seconds_are_metered_on_stop(alice, live_server, stt, db):
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    one_second = 24000 * 2  # bytes of 24 kHz 16-bit audio
    for _ in range(3):
        await ws.send(b"\x00" * one_second)
    await ws.send(json.dumps({"type": "stop"}))
    await close_code(ws)
    assert await _seconds(db) == 3


async def test_a_user_already_at_the_cap_is_refused_immediately(alice, live_server, db, settings):
    s = await new_session(alice)
    user = (await db.execute(select(User))).scalar_one()
    db.add(
        Usage(
            user_id=user.id,
            day=datetime.now(UTC).date(),
            stt_seconds=settings.cap_stt_seconds_daily,
        )
    )
    await db.commit()
    ws = await connect(live_server, s["session_id"])
    await ws.send(json.dumps({"type": "auth", "token": s["audio_token"]}))
    assert (await recv(ws))["type"] == "cap"
    assert await close_code(ws) == 4429


async def test_the_cap_is_enforced_mid_session(alice, live_server, stt, settings, db):
    settings.cap_stt_seconds_daily = 2
    settings.usage_flush_seconds = 0.15
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    one_second = 24000 * 2
    for _ in range(4):
        await ws.send(b"\x00" * one_second)
    assert (await next_event(ws, "cap"))["type"] == "cap"
    assert await close_code(ws) == 4429
    assert await _seconds(db) >= 2


async def test_session_end_stops_new_sockets_but_keeps_the_transcript(alice, live_server, stt, db):
    s = await new_session(alice)
    ws, _ = await open_ready(live_server, s["session_id"], s["audio_token"])
    (await stt.stream()).emit("final", "Last question?")
    await next_event(ws, "final")
    await ws.close()
    await asyncio.sleep(0.2)
    end = (await alice.post(f"/api/sessions/{s['session_id']}/end")).json()
    assert end == {"status": "ended", "utterances": 1, "suggestions": 0}
    sess = await db.get(PracticeSession, uuid.UUID(s["session_id"]))
    await db.refresh(sess)
    assert sess.status == "ended" and sess.ended_at is not None


async def test_the_real_hub_dependency_works_on_a_websocket_route(alice, live_server, app, hub):
    """Every other test overrides get_hub. Without the override the route must still accept a
    WebSocket (it once returned HTTP 500 because the dependency asked for an HTTP Request)."""
    from app.deps import get_hub

    app.dependency_overrides.pop(get_hub)
    app.state.live_hub = hub
    s = await new_session(alice)
    ws, ready = await open_ready(live_server, s["session_id"], s["audio_token"])
    assert ready["type"] == "ready"
    await ws.close()
