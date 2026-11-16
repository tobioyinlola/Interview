import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user, get_suggester
from app.errors import ApiError
from app.models import PracticeSession, User
from app.repositories import (
    AudioTokenRepo,
    CompaniesRepo,
    IdempotencyRepo,
    LiveRepo,
    NotesRepo,
    SessionsRepo,
)
from app.schemas.api import (
    AudioTokenOut,
    SessionCreateIn,
    SessionCreateOut,
    SessionDetailOut,
    SessionEndOut,
    SuggestIn,
    SuggestionOut,
    UtteranceOut,
)
from app.services.suggest import SuggestionService

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
    """Start a practice session. Refused unless the user confirmed the partner knows the assistant
    is on. The confirmation time is stored with the session."""
    if body.consent is not True:
        raise ApiError(
            400,
            "consent_required",
            "Confirm that your practice partner knows the assistant is listening.",
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
    if company_id is not None:
        companies = CompaniesRepo(db, user.id)
        if await companies.get(company_id) is None:
            raise ApiError(404, "company_not_found", "Company not found.")
        brief = await companies.current_brief(company_id)
        brief_id = brief.id if brief else None

    note = await NotesRepo(db, user.id).get()
    role = body.role if body.role is not None else (note.role if note else "")
    confirmed_at = datetime.now(UTC)
    row = await SessionsRepo(db, user.id).create(
        consent_confirmed_at=confirmed_at,
        company_id=company_id,
        brief_id=brief_id,
        role=role,
        notes_snapshot=note.content if note else "",
    )
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
) -> SessionEndOut:
    live = LiveRepo(db, user.id)
    row = await live.end_session(session_id)
    if row is None:
        raise ApiError(404, "session_not_found", "Session not found.")
    suggester.forget(session_id)
    return SessionEndOut(
        status=row.status,
        utterances=len(await live.utterances(session_id)),
        suggestions=len(await live.suggestions(session_id)),
    )


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: uuid.UUID,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> SessionDetailOut:
    row = await _own_session(db, user, session_id)
    live = LiveRepo(db, user.id)
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
        suggestions=[
            SuggestionOut.model_validate(s, from_attributes=True)
            for s in await live.suggestions(session_id)
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
    lines = [f"Practice session {row.started_at:%Y-%m-%d %H:%M} UTC", ""]
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
) -> StreamingResponse:
    """Stream an answer outline as server-sent events: delta, skip, done or error. If the client
    disconnects, the stream (and the model call under it) is cancelled."""
    await _own_session(db, user, session_id)
    user_id = user.id
    await db.close()  # release the connection: the stream uses its own short sessions

    async def events() -> AsyncIterator[bytes]:
        async for event in suggester.stream(
            user_id=user_id,
            session_id=session_id,
            question_text=body.question_text,
            utterance_ids=body.utterance_ids,
            regenerate=body.regenerate,
        ):
            yield _sse(event)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )
