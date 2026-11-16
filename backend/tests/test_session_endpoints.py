import re
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models import Suggestion, User
from app.repositories import LiveRepo


@pytest.fixture
async def alice(new_client, sign_in):
    async with new_client() as c:
        await sign_in(c, "alice@example.com")
        yield c


async def make(client, **body):
    r = await client.post("/api/sessions", json={"consent": True, **body})
    return r.json()


async def utter(db, sid, seq, text, speaker="partner"):
    user = (await db.execute(select(User))).scalars().first()
    return await LiveRepo(db, user.id).save_utterance(
        uuid.UUID(sid),
        seq=seq,
        speaker=speaker,
        text=text,
        started_at=None,
        ended_at=datetime(2026, 11, 16, 14, 5, seq, tzinfo=UTC),
    )


async def test_create_returns_a_single_use_token_and_the_audio_rate(alice, settings):
    s = await make(alice)
    assert len(s["audio_token"]) > 30 and s["sample_rate"] == settings.stt_sample_rate


async def test_a_retried_create_gets_the_same_session_and_a_fresh_token(alice):
    h = {"idempotency-key": "go-1"}
    a = (await alice.post("/api/sessions", json={"consent": True}, headers=h)).json()
    b = (await alice.post("/api/sessions", json={"consent": True}, headers=h)).json()
    assert a["session_id"] == b["session_id"]
    assert a["audio_token"] and b["audio_token"] and a["audio_token"] != b["audio_token"]


async def test_audio_token_endpoint(alice, new_client, sign_in, settings):
    s = await make(alice)
    r = await alice.post(f"/api/sessions/{s['session_id']}/audio-token")
    assert r.status_code == 200
    assert r.json()["expires_in"] == settings.audio_token_ttl_seconds
    assert r.json()["audio_token"] != s["audio_token"]

    async with new_client() as other:
        await sign_in(other, "b@example.com")
        assert (await other.post(f"/api/sessions/{s['session_id']}/audio-token")).status_code == 404
    async with new_client() as anon:
        assert (await anon.post(f"/api/sessions/{s['session_id']}/audio-token")).status_code == 401

    await alice.post(f"/api/sessions/{s['session_id']}/end")
    ended = await alice.post(f"/api/sessions/{s['session_id']}/audio-token")
    assert ended.status_code == 409 and ended.json()["error"]["code"] == "session_not_active"


async def test_end_is_idempotent_and_reports_counts(alice, db):
    s = await make(alice)
    await utter(db, s["session_id"], 1, "Q one?")
    a = await alice.post(f"/api/sessions/{s['session_id']}/end")
    b = await alice.post(f"/api/sessions/{s['session_id']}/end")
    assert a.json() == b.json() == {"status": "ended", "utterances": 1, "suggestions": 0}


async def test_end_unknown_or_foreign_session_is_404(alice, new_client, sign_in):
    assert (await alice.post(f"/api/sessions/{uuid.uuid4()}/end")).status_code == 404
    s = await make(alice)
    async with new_client() as other:
        await sign_in(other, "b@example.com")
        assert (await other.post(f"/api/sessions/{s['session_id']}/end")).status_code == 404
        # ...and the attempt did not end it
        assert (await alice.get(f"/api/sessions/{s['session_id']}")).json()["status"] == "active"


async def test_session_detail_lists_the_transcript_in_order_with_outlines(alice, db):
    s = await make(alice)
    sid = s["session_id"]
    await utter(db, sid, 2, "second")
    u1 = await utter(db, sid, 1, "first?")
    db.add(
        Suggestion(
            session_id=uuid.UUID(sid),
            utterance_id=u1,
            question_text="first?",
            type="behavioral",
            output_text="TYPE: behavioral",
            grounding_flags=["x"],
        )
    )
    await db.commit()
    d = (await alice.get(f"/api/sessions/{sid}")).json()
    assert [u["text"] for u in d["utterances"]] == ["first?", "second"]
    assert d["suggestions"][0]["utterance_id"] == str(u1)
    assert d["suggestions"][0]["grounding_flags"] == ["x"]
    assert d["consent_confirmed_at"] and d["status"] == "active"


async def test_transcript_download_is_plain_text_with_timestamps(alice, db):
    s = await make(alice)
    sid = s["session_id"]
    await utter(db, sid, 1, "Tell me about yourself.")
    await utter(db, sid, 2, "I led a launch.", speaker="you")
    r = await alice.get(f"/api/sessions/{sid}/transcript.txt")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert "attachment" in r.headers["content-disposition"]
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("Practice session 2026-") or lines[0].startswith("Practice session ")
    assert "[14:05:01] Partner: Tell me about yourself." in lines
    assert "[14:05:02] You: I led a launch." in lines


async def test_transcript_and_detail_are_private(alice, new_client, sign_in, db):
    s = await make(alice)
    await utter(db, s["session_id"], 1, "private words")
    async with new_client() as other:
        await sign_in(other, "b@example.com")
        for path in ("", "/transcript.txt"):
            r = await other.get(f"/api/sessions/{s['session_id']}{path}")
            assert r.status_code == 404 and "private words" not in r.text


async def test_end_clears_the_cached_context(alice, suggester):
    s = await make(alice)
    sid = uuid.UUID(s["session_id"])
    await alice.post(f"/api/sessions/{s['session_id']}/suggest", json={"question_text": "Why us?"})
    assert sid in suggester._ctx  # built once on first question
    await alice.post(f"/api/sessions/{s['session_id']}/end")
    assert sid not in suggester._ctx
    assert re.fullmatch(r"[0-9a-f-]{36}", s["session_id"])
