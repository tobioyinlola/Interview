import base64
import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import metrics
from app.adapters.interfaces import ProviderError, ProviderNotConfigured, SttProvider
from app.autoapply import interviews
from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, get_hub, get_notifier, get_scorer, get_stt, get_suggester
from app.errors import ApiError
from app.models import PracticeSession, User
from app.repositories import (
    AudioTokenRepo,
    BillingRepo,
    CompaniesRepo,
    IdempotencyRepo,
    LiveRepo,
    NotesRepo,
    SessionsRepo,
    UsageMeterRepo,
)
from app.schemas.api import (
    AudioTokenOut,
    FeedbackIn,
    GapOut,
    ScoreOut,
    ScoreStartedOut,
    SegmentOut,
    SessionCreateIn,
    SessionCreateOut,
    SessionDetailOut,
    SessionEndOut,
    SessionListOut,
    SessionSummary,
    SuggestIn,
    SuggestionOut,
    UtteranceOut,
)
from app.services.events import record_from
from app.services.gaps import find_gaps
from app.services.live import LiveHub
from app.services.notify import Notifier
from app.services.suggest import SuggestionService
from app.services.vocab import session_stt_prompt
from app.workers.scoring_worker import ScoringRunner

router = APIRouter(prefix="/api", tags=["sessions"])
ROUTE = "POST /api/sessions"


async def _token(db: AsyncSession, settings: Settings, user: User, sid: uuid.UUID) -> str:
    repo = AudioTokenRepo(db, settings.cookie_secret.get_secret_value())
    return await repo.issue(user.id, sid, ttl=timedelta(seconds=settings.audio_token_ttl_seconds))


async def _own_session(db: AsyncSession, user: User, session_id: uuid.UUID) -> PracticeSession:
    row = await SessionsRepo(db, user.id).get(session_id)
    if row is None:
        raise ApiError(404, "session_not_found", "Session not found.")
    return row


@router.post("/sessions", status_code=201)
async def create_session(
    body: SessionCreateIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    idempotency_key: str | None = Header(default=None, max_length=200),
) -> SessionCreateOut:
    """Start an interview session. The person agreed at sign-up that their partner knows the
    assistant is on; every account has that on record, and the session stores when. An account
    without it cannot start a session."""
    if user.practice_consent_at is None:
        raise ApiError(
            400,
            "consent_required",
            "Agree to the terms about your interview partner before starting a session.",
        )

    idem = IdempotencyRepo(db, user.id)
    if idempotency_key:
        saved = await idem.find(idempotency_key, ROUTE)
        if saved is not None:  # a retried click: same session, but a fresh single-use token
            out = SessionCreateOut.model_validate(saved)
            out.audio_token = await _token(db, settings, user, out.session_id)
            out.sample_rate = settings.stt_sample_rate
            return out

    company_id = body.company_id
    brief_id = None
    handoff_role: str | None = None
    handoff_notes: str | None = None
    if body.interview_id is not None:
        if not settings.autoapply_enabled:
            raise ApiError(404, "interview_not_found", "Interview not found.")
        try:
            company_id, handoff_role, handoff_notes = await interviews.session_context(
                db, user.id, body.interview_id
            )
        except interviews.HandoffError as exc:
            raise ApiError(exc.status, exc.code, exc.message) from None
    if company_id is not None:
        companies = CompaniesRepo(db, user.id)
        if await companies.get(company_id) is None:
            raise ApiError(404, "company_not_found", "Company not found.")
        brief = await companies.current_brief(company_id)
        brief_id = brief.id if brief else None

    # A session costs one credit: the free trial, a redeemed invite reward, or (later) a paid one.
    # Taken before anything is written; if nothing goes wrong below it is saved with the session,
    # and if anything does, it is not spent.
    credit = None
    if settings.enforce_session_credits:
        credit = await BillingRepo(
            db, user, per_reward=max(1, settings.referrals_per_free_session)
        ).take_credit()
    if credit is None and settings.enforce_session_credits:
        await record_from(db, "session.blocked", user_id=user.id)
        raise ApiError(
            402,
            "payment_required",
            "You have used your free session. Paying for more sessions is coming soon. "
            "Invite friends to earn a free one.",
        )

    note = await NotesRepo(db, user.id).get()
    role = body.role if body.role is not None else (note.role if note else "")
    if handoff_role is not None:
        role = handoff_role
    confirmed_at = user.practice_consent_at
    row = await SessionsRepo(db, user.id).create(
        consent_confirmed_at=confirmed_at,
        company_id=company_id,
        brief_id=brief_id,
        role=role,
        notes_snapshot=handoff_notes
        if handoff_notes is not None
        else (note.content if note else ""),
    )
    if credit is not None:
        credit.session_id = row.id
    out = SessionCreateOut(session_id=row.id, status=row.status, consent_confirmed_at=confirmed_at)
    if idempotency_key:
        payload: dict[str, Any] = out.model_dump(mode="json")
        idem.add(idempotency_key, ROUTE, payload)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        saved = await idem.find(idempotency_key or "", ROUTE)
        if saved is None:
            raise
        out = SessionCreateOut.model_validate(saved)
    await record_from(
        db,
        "session.started",
        user_id=user.id,
        session_id=out.session_id,
        credit=credit.kind if credit is not None else "not_enforced",
        company=company_id is not None,
    )
    out.audio_token = await _token(db, settings, user, out.session_id)
    out.sample_rate = settings.stt_sample_rate
    return out


@router.post("/sessions/{session_id}/audio-token")
async def audio_token(
    session_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> AudioTokenOut:
    """A fresh single-use token, for a reconnect or a second audio source (the microphone)."""
    row = await _own_session(db, user, session_id)
    if row.status != "active":
        raise ApiError(409, "session_not_active", "This session has ended.")
    return AudioTokenOut(
        audio_token=await _token(db, settings, user, session_id),
        expires_in=settings.audio_token_ttl_seconds,
        sample_rate=settings.stt_sample_rate,
    )


@router.post("/sessions/{session_id}/end")
async def end_session(
    session_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    suggester: SuggestionService = Depends(get_suggester),  # noqa: B008
    hub: LiveHub = Depends(get_hub),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    notifier: Notifier = Depends(get_notifier),  # noqa: B008
) -> SessionEndOut:
    live = LiveRepo(db, user.id)
    existing = await SessionsRepo(db, user.id).get(session_id)
    was_active = existing is not None and existing.status == "active"
    row = await live.end_session(session_id)
    if row is None:
        raise ApiError(404, "session_not_found", "Session not found.")
    suggester.forget(session_id)
    await hub.broadcast_desktop(session_id, {"type": "end"})
    out = SessionEndOut(
        status=row.status,
        utterances=len(await live.utterances(session_id)),
        suggestions=len(await live.suggestions(session_id)),
    )
    if was_active:  # ending twice is harmless and is not a second event
        seconds = int((row.ended_at - row.started_at).total_seconds()) if row.ended_at else 0
        await record_from(
            db,
            "session.ended",
            user_id=user.id,
            session_id=session_id,
            seconds=seconds,
            questions=out.suggestions,
        )
        if settings.enforce_session_credits:
            left = await BillingRepo(
                db, user, per_reward=max(1, settings.referrals_per_free_session)
            ).summary()
            if (
                left.trial_available
                + left.referral_available
                + left.paid_available
                + left.granted_available
                == 0
            ):
                await notifier.trial_used(user.id)
    return out


@router.get("/sessions/{session_id}/pin")
async def get_session_pin(
    session_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    hub: LiveHub = Depends(get_hub),  # noqa: B008
) -> dict[str, Any]:
    """Retrieve or generate a 6-digit sync PIN for the desktop stealth overlay."""
    row = await _own_session(db, user, session_id)
    if row.status != "active":
        raise ApiError(409, "session_not_active", "This session has ended.")
    pin = hub.get_or_create_pin(session_id)
    return {
        "session_id": str(session_id),
        "pin": pin,
        "formatted_pin": f"{pin[:3]}-{pin[3:]}",
        "connected_clients": hub.desktop_client_count(session_id),
    }


@router.post("/sessions/{session_id}/test-desktop")
async def test_desktop_stream(
    session_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    hub: LiveHub = Depends(get_hub),  # noqa: B008
) -> dict[str, Any]:
    """Send a test prompt/outline to any connected desktop stealth HUDs."""
    await _own_session(db, user, session_id)
    count = hub.desktop_client_count(session_id)
    await hub.broadcast_desktop(
        session_id,
        {
            "type": "test",
            "question": "Tell me about a time you solved a complex engineering challenge.",
            "text": "ANSWER:\nStructure your answer using STAR:\n1. Situation: High latency in distributed service.\n2. Task: Reduce p99 response times below 100ms.\n3. Action: Profiled system bottlenecks, implemented connection pooling and caching.\n4. Result: Decreased p99 latency by 70% and improved throughput.",
        },
    )
    return {"status": "ok", "delivered_to": count}


@router.websocket("/sessions/stream")
@router.websocket("/stream")
async def desktop_stream(
    ws: WebSocket,
    pin: str = Query(...),
    hub: LiveHub = Depends(get_hub),  # noqa: B008
) -> None:
    """Real-time WebSocket stream for the desktop stealth client authenticated via PIN."""
    await ws.accept()
    clean_pin = pin.replace("-", "").strip()
    session_id = hub.get_session_by_pin(clean_pin)
    if session_id is None:
        await ws.send_json({"type": "error", "message": "Invalid or expired PIN."})
        await ws.close(code=4401)
        return

    hub.register_desktop(session_id, ws)
    await ws.send_json(
        {
            "type": "connected",
            "session_id": str(session_id),
            "pin": clean_pin,
        }
    )
    last = hub.last_events.get(session_id)
    if last:
        await ws.send_json(last)

    try:
        while True:
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
                if data.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
            except Exception:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        hub.unregister_desktop(session_id, ws)


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> SessionDetailOut:
    row = await _own_session(db, user, session_id)
    live = LiveRepo(db, user.id)
    suggestions = await live.suggestions(session_id)
    return SessionDetailOut(
        id=row.id,
        status=row.status,
        company_id=row.company_id,
        role=row.role,
        started_at=row.started_at,
        ended_at=row.ended_at,
        consent_confirmed_at=row.consent_confirmed_at,
        utterances=[
            UtteranceOut.model_validate(u, from_attributes=True)
            for u in await live.utterances(session_id)
        ],
        suggestions=[SuggestionOut.model_validate(s, from_attributes=True) for s in suggestions],
        scoring_status=row.scoring_status,
        scoring_error=row.scoring_error,
        scores=[
            ScoreOut.model_validate(sc, from_attributes=True)
            for sc in await live.scores(session_id)
        ],
        gaps=[
            GapOut(kind=g.kind, type=g.type, questions=g.questions, hint=g.hint)
            for g in find_gaps(suggestions)
        ],
    )


@router.get("/sessions/{session_id}/transcript.txt", response_class=PlainTextResponse)
async def transcript(
    session_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> PlainTextResponse:
    """The saved transcript as text, with timestamps (FR-34)."""
    row = await _own_session(db, user, session_id)
    lines = [f"Interview session {row.started_at:%Y-%m-%d %H:%M} UTC", ""]
    for u in await LiveRepo(db, user.id).utterances(session_id):
        when = u.ended_at.strftime("%H:%M:%S") if u.ended_at else "--:--:--"
        who = "You" if u.speaker == "you" else "Partner"
        lines.append(f"[{when}] {who}: {u.text}")
    return PlainTextResponse(
        "\n".join(lines) + "\n",
        headers={"content-disposition": f'attachment; filename="session-{row.id}.txt"'},
    )


def _sse(event: dict[str, Any]) -> bytes:
    return f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n".encode()


@router.post("/sessions/{session_id}/suggest")
async def suggest(
    session_id: uuid.UUID,
    body: SuggestIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    suggester: SuggestionService = Depends(get_suggester),  # noqa: B008
    hub: LiveHub = Depends(get_hub),  # noqa: B008
) -> StreamingResponse:
    """Stream an answer outline as server-sent events: delta, skip, done or error. If the client
    disconnects, the stream (and the model call under it) is cancelled."""
    await _own_session(db, user, session_id)
    user_id = user.id
    await db.close()  # release the connection: the stream uses its own short sessions

    async def events() -> AsyncIterator[bytes]:
        await hub.broadcast_desktop(
            session_id,
            {"type": "question", "question": body.question_text, "text": ""},
        )
        accumulated_text = ""
        async for event in suggester.stream(
            user_id=user_id,
            session_id=session_id,
            question_text=body.question_text,
            utterance_ids=body.utterance_ids,
            regenerate=body.regenerate,
        ):
            ev_name = event.get("event")
            ev_data = event.get("data", {})
            if ev_name == "delta":
                delta_chunk = ev_data.get("text", "")
                accumulated_text += delta_chunk
                await hub.broadcast_desktop(
                    session_id,
                    {
                        "type": "delta",
                        "text": delta_chunk,
                        "accumulated": accumulated_text,
                        "question": body.question_text,
                    },
                )
            elif ev_name == "done":
                await hub.broadcast_desktop(
                    session_id,
                    {
                        "type": "done",
                        "text": accumulated_text,
                        "question": body.question_text,
                        "suggestion_id": ev_data.get("suggestion_id"),
                        "first_token_ms": ev_data.get("first_token_ms"),
                        "total_ms": ev_data.get("total_ms"),
                    },
                )
            elif ev_name == "skip":
                await hub.broadcast_desktop(session_id, {"type": "skip"})
            elif ev_name == "error":
                await hub.broadcast_desktop(
                    session_id,
                    {"type": "error", "message": ev_data.get("message", "Answer failed")},
                )
            yield _sse(event)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )


# ----------------------------------------------------------- list, delete, score


def _encode_cursor(row: PracticeSession) -> str:
    raw = f"{row.started_at.isoformat()}|{row.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        t, i = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        return datetime.fromisoformat(t), uuid.UUID(i)
    except (ValueError, TypeError):
        raise ApiError(422, "invalid_cursor", "That page marker is not valid.") from None


@router.get("/sessions")
async def list_sessions(
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = None,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> SessionListOut:
    """Past sessions, newest first, with cursor pagination."""
    rows = await LiveRepo(db, user.id).list_sessions(
        limit=limit + 1, cursor=_decode_cursor(cursor) if cursor else None
    )
    page = rows[:limit]
    items = [
        SessionSummary(
            id=r.id,
            started_at=r.started_at,
            ended_at=r.ended_at,
            duration_seconds=int((r.ended_at - r.started_at).total_seconds())
            if r.ended_at
            else None,
            status=r.status,
            company_id=r.company_id,
            company_name=name,
            question_count=n,
        )
        for r, name, n in page
    ]
    return SessionListOut(
        items=items, next_cursor=_encode_cursor(page[-1][0]) if len(rows) > limit else None
    )


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    suggester: SuggestionService = Depends(get_suggester),  # noqa: B008
) -> dict[str, str]:
    """Delete one session with its transcript, outlines and scores. It leaves the app at once."""
    if not await LiveRepo(db, user.id).delete_session(session_id):
        raise ApiError(404, "session_not_found", "Session not found.")
    suggester.forget(session_id)
    return {"status": "ok"}


@router.post("/sessions/{session_id}/score", status_code=202)
async def score_session(
    session_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    scorer: ScoringRunner = Depends(get_scorer),  # noqa: B008
) -> ScoreStartedOut:
    """Score the user's answers after the session. Poll GET /sessions/{id} for the result."""
    row = await _own_session(db, user, session_id)
    if row.status == "active":
        raise ApiError(409, "session_active", "End the session before scoring it.")
    if await LiveRepo(db, user.id).begin_scoring(session_id) == "started":
        scorer.start(session_id, user.id)
    return ScoreStartedOut(status="running")


@router.post("/suggestions/{suggestion_id}/feedback")
async def suggestion_feedback(
    suggestion_id: uuid.UUID,
    body: FeedbackIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> dict[str, str]:
    """Thumbs up or down on an outline, stored with the session."""
    if not await LiveRepo(db, user.id).set_feedback(suggestion_id, body.value):
        raise ApiError(404, "suggestion_not_found", "Outline not found.")
    await record_from(db, "answer.rated", user_id=user.id, value=body.value)
    return {"status": "ok"}


# ---------------------------------------------------- fallback transcription (FR-20)

MAX_SEGMENT_BYTES = 2 * 1024 * 1024  # about 40 s of 24 kHz audio


@router.post("/sessions/{session_id}/segment")
async def transcribe_segment(
    session_id: uuid.UUID,
    request: Request,
    speaker: str = Query(default="partner", pattern="^(partner|you)$"),
    sample_rate: int = Query(default=24000, ge=8000, le=48000),
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
    stt: SttProvider = Depends(get_stt),  # noqa: B008
    hub: LiveHub = Depends(get_hub),  # noqa: B008
) -> SegmentOut:
    """When live streaming keeps failing, the browser cuts speech into segments and sends each
    one here. Audio is transcribed and discarded; only the text is saved, as with a caption."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_SEGMENT_BYTES:
        raise ApiError(413, "segment_too_large", "That audio segment is too long.")
    pcm = await request.body()
    if not pcm or len(pcm) > MAX_SEGMENT_BYTES:
        raise ApiError(413, "segment_too_large", "That audio segment is empty or too long.")
    live = LiveRepo(db, user.id)
    session = await live.active_session(session_id)
    if session is None:
        raise ApiError(409, "session_not_active", "This session has ended.")

    meter = UsageMeterRepo(db, user.id)
    seconds = max(1, round(len(pcm) / (2 * sample_rate)))
    if await meter.stt_seconds_today() + seconds > settings.cap_stt_seconds_daily:
        raise ApiError(429, "daily_cap", "You've reached today's transcription limit.")
    try:
        hint = await session_stt_prompt(db, session)
        text = (await stt.transcribe_segment(pcm, sample_rate=sample_rate, prompt=hint)).strip()
    except ProviderNotConfigured as exc:
        raise ApiError(503, "not_configured", exc.message) from None
    except ProviderError as exc:
        metrics.provider_calls.labels("stt", "segment", "error").inc()
        raise ApiError(502, "transcription_failed", exc.message) from None
    metrics.provider_calls.labels("stt", "segment", "ok").inc()
    await meter.add_stt_seconds(seconds)
    if not text:
        return SegmentOut(id=None, seq=None, text="", ended_at=None)

    async def seed() -> int:
        return await live.max_seq(session_id)

    seq = await hub.seq.take(session_id, seed)
    ended = datetime.now(UTC)
    utt_id = uuid.uuid4()
    await live.save_utterance(
        session_id,
        seq=seq,
        speaker=speaker,
        text=text,
        started_at=None,
        ended_at=ended,
        utterance_id=utt_id,
    )
    return SegmentOut(id=utt_id, seq=seq, text=text, ended_at=ended)
