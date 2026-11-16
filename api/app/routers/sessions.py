from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Header
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import User
from app.repositories import CompaniesRepo, IdempotencyRepo, NotesRepo, SessionsRepo
from app.schemas.api import SessionCreateIn, SessionCreateOut

router = APIRouter(prefix="/api", tags=["sessions"])
ROUTE = "POST /api/sessions"


@router.post("/sessions", status_code=201)
async def create_session(
    body: SessionCreateIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
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
        if saved is not None:
            return SessionCreateOut.model_validate(saved)

    company_id = body.company_id
    brief_id = None
    if company_id is not None:
        brief = await CompaniesRepo(db, user.id).current_brief(company_id)
        if await CompaniesRepo(db, user.id).get(company_id) is None:
            raise ApiError(404, "company_not_found", "Company not found.")
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
        # A concurrent retry with the same key won: return its stored response.
        await db.rollback()
        saved = await idem.find(idempotency_key or "", ROUTE)
        if saved is None:
            raise
        return SessionCreateOut.model_validate(saved)
    return out
