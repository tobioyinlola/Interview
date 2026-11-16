import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.brief import BriefContent

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
    # Single-use, 60 s. Sent as the first WebSocket message. Absent on an idempotent replay
    # (ask /audio-token for a fresh one).
    audio_token: str | None = None
    sample_rate: int = 24000


class AudioTokenOut(BaseModel):
    audio_token: str
    expires_in: int
    sample_rate: int


class SessionEndOut(BaseModel):
    status: str
    utterances: int
    suggestions: int


class UtteranceOut(BaseModel):
    id: uuid.UUID
    seq: int
    speaker: str
    text: str
    started_at: datetime | None
    ended_at: datetime | None


class SuggestionOut(BaseModel):
    id: uuid.UUID
    utterance_id: uuid.UUID | None
    question_text: str
    type: str
    output_text: str
    first_token_ms: int | None
    total_ms: int | None
    grounding_flags: list[str]
    feedback: str | None
    created_at: datetime


class ScoreOut(BaseModel):
    id: uuid.UUID
    utterance_id: uuid.UUID
    question_text: str
    answer_text: str
    structure: int
    specificity: int
    impact: int
    relevance: int
    pace: int
    overall: int
    fixes: list[str]


class GapOut(BaseModel):
    kind: str  # experience | company
    type: str
    questions: list[str]
    hint: str


class SessionDetailOut(BaseModel):
    id: uuid.UUID
    status: str
    company_id: uuid.UUID | None
    role: str
    started_at: datetime
    ended_at: datetime | None
    consent_confirmed_at: datetime
    utterances: list[UtteranceOut]
    suggestions: list[SuggestionOut]
    scoring_status: str  # none | running | ready | failed
    scoring_error: str | None
    scores: list[ScoreOut]
    gaps: list[GapOut]


class SessionSummary(BaseModel):
    id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: int | None
    status: str
    company_id: uuid.UUID | None
    company_name: str | None
    question_count: int


class SessionListOut(BaseModel):
    items: list[SessionSummary]
    next_cursor: str | None


class FeedbackIn(BaseModel):
    value: str = Field(pattern="^(up|down)$")


class ScoreStartedOut(BaseModel):
    status: str


class SegmentOut(BaseModel):
    id: uuid.UUID | None
    seq: int | None
    text: str
    ended_at: datetime | None


class SuggestIn(BaseModel):
    question_text: str = Field(min_length=1, max_length=2000)
    utterance_ids: list[uuid.UUID] = Field(default_factory=list, max_length=5)
    regenerate: bool = False


# ----------------------------------------------------------------- companies


def _blank_to_none(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


class CompanyIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    website_url: str | None = Field(default=None, max_length=2048)
    job_posting_url: str | None = Field(default=None, max_length=2048)
    extra_links: list[str] = Field(default_factory=list, max_length=3)
    role: str = Field(default="", max_length=200)
    known_text: str = Field(default="", max_length=2000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("website_url", "job_posting_url")
    @classmethod
    def _optional_url(cls, v: str | None) -> str | None:
        return _blank_to_none(v)

    @field_validator("extra_links")
    @classmethod
    def _links(cls, v: list[str]) -> list[str]:
        return [x.strip() for x in v if x and x.strip()]


class CompanyOut(BaseModel):
    id: uuid.UUID
    name: str
    website_url: str | None
    job_posting_url: str | None
    extra_links: list[str]
    role: str
    known_text: str
    last_researched_at: datetime | None
    created_at: datetime


class JobOut(BaseModel):
    id: uuid.UUID
    status: str  # queued | reading_pages | searching | writing | ready | failed
    step_detail: str
    error: str | None
    started_at: datetime
    finished_at: datetime | None


class CompanySummary(BaseModel):
    id: uuid.UUID
    name: str
    last_researched_at: datetime | None
    job_status: str | None


class SourceOut(BaseModel):
    id: uuid.UUID
    kind: str
    url: str | None
    title: str
    status: str  # ok | blocked | login_required | too_large | timeout | disallowed
    reason: str
    published_at: str | None
    fetched_at: datetime | None


class CompanyDetailOut(BaseModel):
    company: CompanyOut
    brief: BriefContent | None
    brief_version: int | None
    brief_created_at: datetime | None
    sources: list[SourceOut]
    job: JobOut | None


class CompanyCreatedOut(BaseModel):
    company: CompanyOut
    job_id: uuid.UUID


class ResearchStartedOut(BaseModel):
    job_id: uuid.UUID


class PasteIn(BaseModel):
    title: str = Field(default="Pasted text", max_length=200)
    text: str = Field(min_length=1, max_length=50_000)

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text is required")
        return v


class BriefFactEdit(BaseModel):
    """One change to the brief. No id adds a fact; an id updates, pins or removes (delete) it."""

    id: uuid.UUID | None = None
    section_key: str = Field(min_length=1, max_length=40)
    text: str = Field(default="", max_length=500)
    pinned: bool = False
    delete: bool = False


class BriefEditIn(BaseModel):
    facts: list[BriefFactEdit] = Field(min_length=1, max_length=100)


class BriefEditOut(BaseModel):
    brief: BriefContent
    brief_version: int
