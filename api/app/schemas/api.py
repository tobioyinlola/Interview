import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

NOTES_MAX = 16_000


class RequestLinkIn(BaseModel):
    email: EmailStr


class StatusOut(BaseModel):
    status: str


class VerifyIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class MeOut(BaseModel):
    id: uuid.UUID
    email: str


class NotesIn(BaseModel):
    role: str = Field(default="", max_length=200)
    content: str = Field(default="", max_length=NOTES_MAX)


class NotesOut(BaseModel):
    role: str
    content: str
    updated_at: datetime | None


class SessionCreateIn(BaseModel):
    # Defaults to False so a missing field is refused by the explicit consent check, not by luck.
    consent: bool = False
    company_id: uuid.UUID | None = None
    role: str | None = Field(default=None, max_length=200)


class SessionCreateOut(BaseModel):
    session_id: uuid.UUID
    status: str
    consent_confirmed_at: datetime
