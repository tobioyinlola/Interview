import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.brief import BriefContent

NOTES_MAX = 16_000


class Utm(BaseModel):
    """Campaign tags on the link someone arrived on (utm_source and friends)."""

    source: str | None = Field(default=None, max_length=60)
    medium: str | None = Field(default=None, max_length=60)
    campaign: str | None = Field(default=None, max_length=60)


class RequestLinkIn(BaseModel):
    email: EmailStr
    ref: str | None = Field(default=None, max_length=40)  # an invite code from a link
    utm: Utm | None = None


class StatusOut(BaseModel):
    status: str


class SignUpIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=400)  # the name rules give the message
    password: str = Field(min_length=1, max_length=256)  # the real rules are checked server-side
    ref: str | None = Field(default=None, max_length=40)  # an invite code from a link
    utm: Utm | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class ResetIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=1, max_length=256)


class ProvidersOut(BaseModel):
    google: bool


class VerifyIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


# The onboarding questions and their allowed answers. The web app's options are typed from these.
Goal = Literal["new_job", "promotion", "career_change", "practice"]
Level = Literal["entry", "mid", "senior", "lead"]
Timeline = Literal["this_week", "few_weeks", "few_months", "not_scheduled"]
Focus = Literal["structure", "results", "confidence", "technical", "company", "curveballs"]


class OnboardingAnswers(BaseModel):
    goal: Goal | None = None
    level: Level | None = None
    timeline: Timeline | None = None
    focus: list[Focus] = Field(default_factory=list, max_length=3)


class OnboardingIn(OnboardingAnswers):
    """Finish onboarding with all four answers, or skip it. `role` is the CV page's target role;
    `full_name` is only asked for when the account has none."""

    skipped: bool = False
    role: str | None = Field(default=None, max_length=200)
    full_name: str | None = Field(default=None, max_length=400)


class ProfileIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=400)


class MeOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None = None
    onboarded: bool = True  # false until onboarding is finished or skipped
    onboarding: OnboardingAnswers | None = None
    tour_done: bool = True  # false until the first-time tour was finished or skipped


class TourIn(BaseModel):
    done: bool = True  # false asks for the tour to be shown again


class NotesIn(BaseModel):
    """A field left out is left as it is. The web app sends only the role; the text comes from the
    CV upload."""

    role: str | None = Field(default=None, max_length=200)
    content: str | None = Field(default=None, max_length=NOTES_MAX)


class NotesOut(BaseModel):
    role: str
    content: str  # the text read from the CV
    updated_at: datetime | None
    cv_filename: str | None = None
    cv_uploaded_at: datetime | None = None


class CvUploadOut(NotesOut):
    truncated: bool = False  # the CV was longer than the limit and was cut at a word


class SessionCreateIn(BaseModel):
    # Older clients still send this. Consent is agreed once, at sign-up, and is not asked for here.
    consent: bool | None = None
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


class UsageDay(BaseModel):
    day: str
    sessions: int
    active_users: int
    stt_seconds: int
    llm_input_tokens: int
    llm_output_tokens: int
    research_jobs: int
    research_tokens: int
    estimated_cost_usd: float


class UsageUser(BaseModel):
    email: str
    stt_seconds: int
    tokens: int
    research_jobs: int
    estimated_cost_usd: float


class UsageSummary(BaseModel):
    days: list[UsageDay]
    top_users: list[UsageUser]
    total_cost_usd: float
    sessions: int
    avg_cost_per_session_usd: float | None
    research_jobs: int
    avg_cost_per_research_job_usd: float | None
    caps: dict[str, int]
    prices: dict[str, float]


class BillingOut(BaseModel):
    """How many sessions the person can start, and how far along their invite reward is."""

    sessions_available: int
    trial_available: bool  # the free first session, not yet used
    referral_credits_available: int  # redeemed rewards, not yet used
    paid_credits_available: int
    gifted_credits_available: int = 0  # free interviews the InterviewMeet team added
    payments_enabled: bool  # false until per-session payments exist
    referral_code: str
    referral_link: str
    referrals_qualified: int  # people who signed up with their link
    referrals_held: int  # sign-ups that looked like the same device as the inviter, not counted
    referrals_per_reward: int
    referrals_to_next_reward: int
    rewards_earned: int
    rewards_redeemable: int  # earned and not yet redeemed
