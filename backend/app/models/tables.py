"""All tables. Every row belongs to one user, directly (user_id) or through a parent that has it.
Audio is never stored: there is no audio column anywhere."""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _fk(target: str, **kw: Any) -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), ForeignKey(target, ondelete="CASCADE"), **kw)


_TS = DateTime(timezone=True)

# ---------------------------------------------------------------- user + auth


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(String(320), unique=True)
    # scrypt hash; null for people who only use email links or Google. Never leaves the server.
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # The four onboarding answers (goal, level, timeline, focus) and when onboarding was finished or
    # skipped. A null onboarded_at means the person has not been through it yet.
    onboarding: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    onboarded_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    # When the person agreed, at sign-up, that they only practise with a partner who knows the
    # assistant is on. The app never asks again; every account has it from the moment it exists.
    practice_consent_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    # Where the account came from, for the admin marketing view: how they signed up (password,
    # email_link, google), whether an invite brought them, and the campaign tags on the link.
    attribution: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # When the person finished or skipped the first-time tour of the app. Null: not yet shown.
    tour_done_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    # The code in this person's invite link. Every account has one.
    referral_code: Mapped[str | None] = mapped_column(String(16), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class LoginToken(Base):
    """Single-use email sign-in link. Only a hash of the token is stored. Keyed by email so a
    link can be requested before the user row exists (created at first sign-in)."""

    __tablename__ = "login_tokens"
    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(String(320), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(_TS)
    used_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    # login (sign in), signup (confirm a new account) or reset (choose a new password)
    purpose: Mapped[str] = mapped_column(String(10), server_default="login", default="login")
    # The invite code the person arrived with; applied only if this creates a brand-new account.
    referral_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Campaign tags (utm_source, utm_medium, utm_campaign) from the link they arrived on.
    attribution: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # The device that asked for the link (hashes only), compared with the inviter's devices.
    device_cookie_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    device_print_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    device_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # signup only: the chosen password, hashed, applied only once the email address is proven
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(120), nullable=True)  # signup only


class LoginFailure(Base):
    """One wrong password. Counted per email to slow guessing; contains no password."""

    __tablename__ = "login_failures"
    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    __table_args__ = (Index("ix_login_failures_email_created", "email", "created_at"),)


class AuthSession(Base):
    """Cookie session. Only a hash of the cookie value is stored, so sessions can be revoked."""

    __tablename__ = "auth_sessions"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(_TS)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class AudioToken(Base):
    """Single-use WebSocket credential: 60 s life, bound to one user and one session, sent as the
    first socket message (never in a URL). Only a hash is stored."""

    __tablename__ = "audio_tokens"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    session_id: Mapped[uuid.UUID] = _fk("sessions.id", index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(_TS)
    used_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)


class IdempotencyKey(Base):
    """A retried POST with the same key returns the stored response instead of acting twice."""

    __tablename__ = "idempotency_keys"
    __table_args__ = (UniqueConstraint("user_id", "key", "route"),)
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    key: Mapped[str] = mapped_column(String(200))
    route: Mapped[str] = mapped_column(String(100))
    response: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


# --------------------------------------------------------------- user-owned


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", unique=True)  # one row per user in v1
    role: Mapped[str] = mapped_column(String(200), default="")
    content: Mapped[str] = mapped_column(Text, default="")  # the CV's text, up to 16,000 characters
    cv_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)  # name only
    cv_uploaded_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(_TS, default=_now, onupdate=_now)


class Usage(Base):
    """Counts only. Drives the daily caps and the owner's cost view."""

    __tablename__ = "usage"
    __table_args__ = (UniqueConstraint("user_id", "day"),)
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    day: Mapped[date] = mapped_column(Date)
    stt_seconds: Mapped[int] = mapped_column(Integer, default=0)
    llm_input_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    llm_output_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    research_jobs: Mapped[int] = mapped_column(Integer, default=0)


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    name: Mapped[str] = mapped_column(String(120))
    website_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_posting_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(String(200), default="")
    known_text: Mapped[str] = mapped_column(Text, default="")  # up to 2,000 characters
    extra_links: Mapped[list[Any]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )  # up to 3 URLs
    last_researched_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class CompanySource(Base):
    __tablename__ = "company_sources"
    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = _fk("companies.id", index=True)
    # website | job_posting | extra_link | search_result | pasted | known ("From you")
    kind: Mapped[str] = mapped_column(String(20))
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(Text, default="")
    published_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # ok | blocked | login_required | too_large | timeout | disallowed
    status: Mapped[str] = mapped_column(String(20), default="ok")
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    reason: Mapped[str] = mapped_column(
        Text, default="", server_default=""
    )  # plain-language reason when not ok
    fetched_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    removed_by_user: Mapped[bool] = mapped_column(Boolean, default=False)


class CompanyBrief(Base):
    __tablename__ = "company_briefs"
    __table_args__ = (
        UniqueConstraint("company_id", "version"),
        # At most one current brief per company.
        Index(
            "uq_company_briefs_current",
            "company_id",
            unique=True,
            postgresql_where="is_current",
        ),
    )
    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = _fk("companies.id")
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[dict[str, Any]] = mapped_column(JSONB)  # sections of facts with source_ids
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class ResearchJob(Base):
    __tablename__ = "research_jobs"
    __table_args__ = (Index("ix_research_jobs_company_started", "company_id", "started_at"),)
    id: Mapped[uuid.UUID] = _pk()
    company_id: Mapped[uuid.UUID] = _fk("companies.id")
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    # queued | reading_pages | searching | writing | ready | failed
    status: Mapped[str] = mapped_column(String(20), default="queued")
    step_detail: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    heartbeat_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    search_calls: Mapped[int] = mapped_column(Integer, default=0)
    tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0"
    )  # restarts survived (requeued once)
    refresh: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )  # bypass the 24 h page cache


class PracticeSession(Base):
    __tablename__ = "sessions"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL"), nullable=True
    )
    brief_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("company_briefs.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    # Required: the partner has agreed. The server refuses to create a session without it.
    consent_confirmed_at: Mapped[datetime] = mapped_column(_TS)
    role: Mapped[str] = mapped_column(String(200), default="")
    notes_snapshot: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | ended | errored
    # Answer scoring job: none | running | ready | failed
    scoring_status: Mapped[str] = mapped_column(String(10), default="none", server_default="none")
    scoring_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Utterance(Base):
    __tablename__ = "utterances"
    __table_args__ = (UniqueConstraint("session_id", "seq"),)  # duplicate write is harmless
    id: Mapped[uuid.UUID] = _pk()
    session_id: Mapped[uuid.UUID] = _fk("sessions.id")
    seq: Mapped[int] = mapped_column(Integer)
    speaker: Mapped[str] = mapped_column(String(10))  # partner | you
    text: Mapped[str] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)


class Suggestion(Base):
    __tablename__ = "suggestions"
    __table_args__ = (UniqueConstraint("session_id", "utterance_id"),)
    id: Mapped[uuid.UUID] = _pk()
    session_id: Mapped[uuid.UUID] = _fk("sessions.id")
    utterance_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utterances.id", ondelete="CASCADE"), nullable=True
    )
    question_text: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(String(20), default="")
    output_text: Mapped[str] = mapped_column(Text, default="")
    sources_used: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    first_token_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    grounding_flags: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    feedback: Mapped[str | None] = mapped_column(String(4), nullable=True)  # up | down
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class Score(Base):
    __tablename__ = "scores"
    id: Mapped[uuid.UUID] = _pk()
    session_id: Mapped[uuid.UUID] = _fk("sessions.id")
    utterance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utterances.id", ondelete="CASCADE")
    )
    structure: Mapped[int] = mapped_column(Integer)
    specificity: Mapped[int] = mapped_column(Integer)
    impact: Mapped[int] = mapped_column(Integer)
    relevance: Mapped[int] = mapped_column(Integer)
    pace: Mapped[int] = mapped_column(Integer)
    overall: Mapped[int] = mapped_column(Integer)
    fixes: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    question_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    answer_text: Mapped[str] = mapped_column(Text, default="", server_default="")


class Referral(Base):
    """One person who signed up with another person's invite code. A person can be referred once."""

    __tablename__ = "referrals"
    id: Mapped[uuid.UUID] = _pk()
    referrer_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    referred_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    # counted: it earns toward a reward. held: it looks like the inviter's own device, so it
    # does not.
    status: Mapped[str] = mapped_column(String(10), default="counted", server_default="counted")
    held_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class SessionCredit(Base):
    """The right to start one practice session. `trial` is the free first session everyone gets,
    `referral` comes from redeeming a reward for inviting friends, `paid` is for when payments
    exist. Unused while `used_at` is empty; using one records which session it started."""

    __tablename__ = "session_credits"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    kind: Mapped[str] = mapped_column(String(10))  # trial | referral | paid | grant
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    used_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True
    )


class UserDevice(Base):
    """A device an account has signed in from, as hashes. Used only to tell when an invite comes
    from the inviter's own device; deleted with the account."""

    __tablename__ = "user_devices"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    cookie_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    print_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class Event(Base):
    """One thing that happened on the platform, for the admin log. Holds who, what and a few plain
    facts; never CV text, transcripts or answers. Removed with the account it belongs to."""

    __tablename__ = "events"
    id: Mapped[uuid.UUID] = _pk()
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now, index=True)
    kind: Mapped[str] = mapped_column(String(40), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # The admin who did it, for admin actions. Not a foreign key: the log outlives an admin account.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    data: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )


# ------------------------------------------------------------------------------ Auto-Apply
# Everything below belongs to one user. Mailbox credentials are encrypted before they are stored.


class CandidateFacts(Base):
    """The CV facts the candidate has checked: contact details, skills, links and work history.
    Applications and tailored CVs may only use what is here, so a fact the person never confirmed
    can never be sent to an employer."""

    __tablename__ = "aa_candidate_facts"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", unique=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    verified_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    cv_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # the CV it came from
    updated_at: Mapped[datetime] = mapped_column(_TS, default=_now, onupdate=_now)


class CandidateAnswer(Base):
    """A reusable answer to a question employers keep asking (notice period, work authorisation,
    sponsorship...). It records where the answer came from, and is only reused with approval."""

    __tablename__ = "aa_answers"
    __table_args__ = (UniqueConstraint("user_id", "field"),)
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    field: Mapped[str] = mapped_column(String(60))  # a short key such as "notice_period"
    question: Mapped[str] = mapped_column(String(300), default="")
    value: Mapped[str] = mapped_column(Text, default="")
    normalized: Mapped[str] = mapped_column(String(200), default="")
    provenance: Mapped[str] = mapped_column(String(20), default="candidate")  # candidate | cv
    confirmed_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    reusable: Mapped[bool] = mapped_column(Boolean, default=False)  # approved for reuse
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(_TS, default=_now, onupdate=_now)


class SearchProfile(Base):
    """What to look for, where and how, and what the candidate authorised. One per person."""

    __tablename__ = "aa_profiles"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", unique=True)
    criteria: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    active_hours: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    channels: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)  # form, email, outreach
    daily_application_cap: Mapped[int] = mapped_column(Integer, default=10)
    daily_outreach_cap: Mapped[int] = mapped_column(Integer, default=3)
    policy_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    authorized_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    paused: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    paused_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)  # bumps when criteria change
    updated_at: Mapped[datetime] = mapped_column(_TS, default=_now, onupdate=_now)


class Campaign(Base):
    """One 30-day run. Day 1 is the activation date in the candidate's timezone; outbound work
    closes at the start of day 31. Renewing means a new activation, so a new row."""

    __tablename__ = "aa_campaigns"
    __table_args__ = (
        Index(
            "uq_aa_campaign_active", "user_id", unique=True, postgresql_where="status = 'active'"
        ),
    )
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    profile_id: Mapped[uuid.UUID] = _fk("aa_profiles.id")
    timezone: Mapped[str] = mapped_column(String(64))
    activated_at: Mapped[datetime] = mapped_column(_TS)
    ends_at: Mapped[datetime] = mapped_column(_TS)  # the start of local day 31
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | ended
    ended_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    daily_application_cap: Mapped[int] = mapped_column(Integer)
    daily_outreach_cap: Mapped[int] = mapped_column(Integer)
    channels: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    policy_version: Mapped[str] = mapped_column(String(20))
    authorization: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)  # what was shown


class JobPosting(Base):
    """One real opening, shared by everyone, whichever board it was found on. The canonical key is
    the employer's requisition id when there is one, else the employer's own application URL."""

    __tablename__ = "aa_postings"
    id: Mapped[uuid.UUID] = _pk()
    canonical_key: Mapped[str] = mapped_column(String(400), unique=True)
    company: Mapped[str] = mapped_column(String(160))
    title: Mapped[str] = mapped_column(String(240))
    requisition_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    region: Mapped[str | None] = mapped_column(String(200), nullable=True)  # who may apply
    arrangement: Mapped[str | None] = mapped_column(String(10), nullable=True)
    contract: Mapped[str | None] = mapped_column(String(12), nullable=True)
    seniority: Mapped[str | None] = mapped_column(String(12), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(80), nullable=True)
    salary_min: Mapped[float | None] = mapped_column(nullable=True)
    salary_max: Mapped[float | None] = mapped_column(nullable=True)
    salary_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    salary_period: Mapped[str | None] = mapped_column(String(6), nullable=True)
    sponsorship: Mapped[str | None] = mapped_column(
        String(12), nullable=True
    )  # offered | not_offered
    posted_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    application_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    apply_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    apply_instructions: Mapped[str] = mapped_column(Text, default="")  # subject and documents
    hiring_contact: Mapped[str | None] = mapped_column(String(320), nullable=True)  # public
    questions: Mapped[list[Any]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )  # the form's questions: [{field, label, required, declaration}]
    evidence: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict
    )  # field -> where it came from
    source: Mapped[str] = mapped_column(String(40), default="")
    last_seen_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class JobAlias(Base):
    """Another place the same posting was listed. A repeat sighting never makes a second posting."""

    __tablename__ = "aa_posting_aliases"
    id: Mapped[uuid.UUID] = _pk()
    posting_id: Mapped[uuid.UUID] = _fk("aa_postings.id", index=True)
    source: Mapped[str] = mapped_column(String(40))
    source_url: Mapped[str] = mapped_column(Text, unique=True)
    seen_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class DiscoveryRun(Base):
    """One discovery run per candidate and local day. The unique key is what stops two schedulers
    from both running."""

    __tablename__ = "aa_discovery_runs"
    __table_args__ = (UniqueConstraint("user_id", "local_day"),)
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    campaign_id: Mapped[uuid.UUID] = _fk("aa_campaigns.id", index=True)
    local_day: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), default="running")  # running | done | failed
    found: Mapped[int] = mapped_column(Integer, default=0)
    new: Mapped[int] = mapped_column(Integer, default=0)
    eligible: Mapped[int] = mapped_column(Integer, default=0)
    needs_input: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)


class Application(Base):
    """One candidate's application to one posting. Unique per candidate and posting, so repeated
    discovery or a second source can never produce a second application."""

    __tablename__ = "aa_applications"
    __table_args__ = (
        UniqueConstraint("user_id", "posting_id"),
        Index("ix_aa_applications_user_status", "user_id", "status"),
    )
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    posting_id: Mapped[uuid.UUID] = _fk("aa_postings.id")
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("aa_campaigns.id", ondelete="SET NULL"), nullable=True
    )
    # discovered | eligible | queued | sending | submitted | sent_email | needs_input |
    # confirmation_pending | failed | skipped
    status: Mapped[str] = mapped_column(String(22), default="discovered")
    channel: Mapped[str | None] = mapped_column(String(8), nullable=True)  # form | email
    match: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)  # per-rule evidence
    score: Mapped[float] = mapped_column(default=0.0)
    needs_input: Mapped[list[Any]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )  # [{kind, field, question, reason}]
    answers: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )  # answers given for this application only
    package: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)  # frozen
    package_frozen_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    profile_version: Mapped[int] = mapped_column(Integer, default=0)
    not_before: Mapped[datetime | None] = mapped_column(_TS, nullable=True)  # retry no sooner
    skip_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    recruiting_stage: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    updated_at: Mapped[datetime] = mapped_column(_TS, default=_now, onupdate=_now)


class ApplicationEvent(Base):
    """What happened to an application, in order, for the candidate to read: found, matched,
    sent, an employer reply. Never holds a CV, an email body or credentials."""

    __tablename__ = "aa_application_events"
    id: Mapped[uuid.UUID] = _pk()
    application_id: Mapped[uuid.UUID] = _fk("aa_applications.id", index=True)
    kind: Mapped[str] = mapped_column(String(30))
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class MailboxConnection(Base):
    """A candidate's own mailbox. The token is encrypted; a disconnect removes it."""

    __tablename__ = "aa_mailboxes"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", unique=True)
    provider: Mapped[str] = mapped_column(String(20))  # gmail | fixture
    address: Mapped[str] = mapped_column(String(320))
    capabilities: Mapped[list[Any]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )  # send, read
    token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(14), default="connected")
    # connected | reauth_needed | disconnected
    cursor: Mapped[str | None] = mapped_column(Text, nullable=True)  # where reading resumes
    last_synced_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    connected_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class SubmissionAttempt(Base):
    """One try at sending one application (or one outreach note). The unique idempotency key means
    the same intent can never be dispatched twice, and an attempt whose outcome is unknown keeps
    counting against the daily limit until it is reconciled."""

    __tablename__ = "aa_attempts"
    __table_args__ = (
        Index("ix_aa_attempts_user_day", "user_id", "local_day"),
        Index("ix_aa_attempts_state", "state"),
    )
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    application_id: Mapped[uuid.UUID] = _fk("aa_applications.id", index=True)
    channel: Mapped[str] = mapped_column(String(8))  # form | email | outreach
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    # claimed | dispatched | confirmed | ambiguous | failed | cancelled
    state: Mapped[str] = mapped_column(String(10), default="claimed")
    local_day: Mapped[date] = mapped_column(Date)
    provider_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)  # message id etc.
    thread_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    receipt: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    failure_class: Mapped[str | None] = mapped_column(String(30), nullable=True)
    failure_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    claimed_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    dispatched_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)


class Outreach(Base):
    """A first-contact note to a hiring contact. At most one per candidate and role."""

    __tablename__ = "aa_outreach"
    __table_args__ = (UniqueConstraint("user_id", "posting_id"),)
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    posting_id: Mapped[uuid.UUID] = _fk("aa_postings.id")
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("aa_applications.id", ondelete="SET NULL"), nullable=True
    )
    recipient: Mapped[str] = mapped_column(String(320))
    recipient_source: Mapped[str] = mapped_column(String(20))  # listing | candidate
    subject: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="queued")
    # queued | sending | sent | failed | skipped
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    sent_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
