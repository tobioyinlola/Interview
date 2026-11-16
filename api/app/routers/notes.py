from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user
from app.models import User
from app.repositories import NotesRepo
from app.schemas.api import NotesIn, NotesOut

router = APIRouter(prefix="/api", tags=["notes"])


@router.get("/notes")
async def get_notes(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> NotesOut:
    note = await NotesRepo(db, user.id).get()
    if note is None:
        return NotesOut(role="", content="", updated_at=None)
    return NotesOut(role=note.role, content=note.content, updated_at=note.updated_at)


@router.put("/notes")
async def put_notes(
    body: NotesIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> NotesOut:
    note = await NotesRepo(db, user.id).upsert(role=body.role, content=body.content)
    return NotesOut(role=note.role, content=note.content, updated_at=note.updated_at)
