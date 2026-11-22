import asyncio
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import Note, User
from app.repositories import NotesRepo
from app.schemas.api import CvUploadOut, NotesIn, NotesOut
from app.services.cv import CvError, extract_text, safe_filename
from app.services.events import record_from

router = APIRouter(prefix="/api", tags=["notes"])


def _out(note: Note | None) -> NotesOut:
    if note is None:
        return NotesOut(role="", content="", updated_at=None)
    return NotesOut(
        role=note.role,
        content=note.content,
        updated_at=note.updated_at,
        cv_filename=note.cv_filename,
        cv_uploaded_at=note.cv_uploaded_at,
    )


@router.get("/notes")
async def get_notes(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> NotesOut:
    return _out(await NotesRepo(db, user.id).get())


@router.put("/notes")
async def put_notes(
    body: NotesIn,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> NotesOut:
    return _out(await NotesRepo(db, user.id).upsert(role=body.role, content=body.content))


@router.post("/notes/cv")
async def upload_cv(
    request: Request,
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> CvUploadOut:
    """Upload a CV as the raw request body (PDF, Word .docx or text), with its name in the
    `x-filename` header. Only the text it holds is kept, never the file. Replaces any earlier CV."""
    data = await request.body()  # capped by the body-size limit before it gets here
    try:
        result = await asyncio.wait_for(asyncio.to_thread(extract_text, data), timeout=20)
    except CvError as exc:
        raise ApiError(exc.status, exc.code, exc.message) from None
    except TimeoutError:
        raise ApiError(
            422, "cv_unreadable", "That file took too long to read. Try exporting it again."
        ) from None
    name = safe_filename(unquote(request.headers.get("x-filename", "")))
    note = await NotesRepo(db, user.id).set_cv(text=result.text, filename=name)
    await record_from(
        db, "cv.uploaded", user_id=user.id, characters=len(result.text), truncated=result.truncated
    )
    return CvUploadOut(**_out(note).model_dump(), truncated=result.truncated)


@router.delete("/notes/cv")
async def remove_cv(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
) -> NotesOut:
    """Remove the CV text. The target role stays."""
    out = _out(await NotesRepo(db, user.id).clear_cv())
    await record_from(db, "cv.removed", user_id=user.id)
    return out
