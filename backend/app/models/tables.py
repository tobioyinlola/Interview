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
    # Bio data the person chooses to keep on their account (all optional).
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    headline: Mapped[str | None] = mapped_column(
        String(120), nullable=True
    )  # e.g. "Product manager"
    linkedin_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Startup outreach is by invitation: none (never asked), requested (waiting for the operator),
    # active (the operator switched it on for this person).
    outreach_access: Mapped[str] = mapped_column(String(12), default="none", server_default="none")
    outreach_requested_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    # When the person finished or skipped the first-time tour of the app. Null: not yet shown.
    tour_done_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    # The code in this person's invite link. Every account has one.
    referral_code: Mapped[str | None] = mapped_column(String(16), unique=True, nullable=True)
    # Usage statistics (see services/analytics.py): on until the person turns them off, on every
    # device at once. Turning them off also deletes what was collected.
    analytics_opt_out: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
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
    # Set when an installed app asked for this link: the app's challenge (a hash). Opening the link
    # then hands the app a one-time code instead of signing in the browser it was opened in.
    app_challenge: Mapped[str | None] = mapped_column(String(64), nullable=True)


class AppLoginCode(Base):
    """The hand-off from the system browser back to an installed app after Google sign-in. The app
    made a secret (the verifier) and sent only its hash (the challenge); the code is useless without
    the verifier, lives two minutes and works once. Only a hash of the code is stored."""

    __tablename__ = "app_login_codes"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    challenge: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(_TS)
    used_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


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
    expires_at: Mapped[datetime] = mapped_column(_TS, index=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    # The last request made with this cookie: a session unused for the idle limit is signed out.
    last_seen_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class AudioToken(Base):
    """Single-use WebSocket credential: 60 s life, bound to one user and one session, sent as the
    first socket message (never in a URL). Only a hash is stored."""

    __tablename__ = "audio_tokens"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
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
    # how the uploaded file looked (fonts, sizes, colours, headings, margins); never its words
    cv_layout: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
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
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
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
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    brief_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("company_briefs.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    started_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    # Required: the partner has agreed. The server refuses to create a session without it.
    consent_confirmed_at: Mapped[datetime] = mapped_column(_TS)
    # mock: a practice interview with someone who knows the assistant is on (real-time answers).
    # assisted: a real interview where the interviewer or organisation authorised real-time
    #   assistance; who authorised it and when are recorded.
    # standard: a real interview with no real-time answers: transcript, notes and feedback only.
    mode: Mapped[str] = mapped_column(String(10), default="mock", server_default="mock")
    assist_authorized_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    assist_authorized_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
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
        UUID(as_uuid=True),
        ForeignKey("utterances.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
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
    session_id: Mapped[uuid.UUID] = _fk("sessions.id", index=True)
    utterance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utterances.id", ondelete="CASCADE"), index=True
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
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
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


class ClientEvent(Base):
    """One thing a person did in the app, from the app itself: a screen opened, time spent, a button
    used, a crash. Allow-listed names and short coded values only; there is no text column, so it
    cannot hold anything anyone typed or said. Anonymous until sign-in (a random id kept on the
    device, not a fingerprint). Removed with the account, and by age (ANALYTICS_RETENTION_DAYS)."""

    __tablename__ = "client_events"
    __table_args__ = (
        Index("ix_client_events_user_ts", "user_id", "ts"),
        Index("ix_client_events_device_ts", "device_id", "ts"),
        Index("ix_client_events_name_ts", "name", "ts"),
        Index("ix_client_events_platform_ts", "platform", "ts"),
    )
    id: Mapped[uuid.UUID] = _pk()
    ts: Mapped[datetime] = mapped_column(_TS, index=True)  # when it happened, clamped by the server
    received_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    device_id: Mapped[str] = mapped_column(String(36))
    session_id: Mapped[str] = mapped_column(String(36))
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(32))
    route: Mapped[str | None] = mapped_column(String(80), nullable=True)
    props: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    platform: Mapped[str] = mapped_column(
        String(16)
    )  # web | windows | macos | linux | android | ios
    form_factor: Mapped[str] = mapped_column(String(8))  # phone | tablet | desktop
    app_version: Mapped[str] = mapped_column(String(20), default="")
    locale: Mapped[str] = mapped_column(String(12), default="")
    viewport: Mapped[str] = mapped_column(String(3), default="")  # xs | sm | md | lg | xl


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
    profile_id: Mapped[uuid.UUID] = _fk("aa_profiles.id", index=True)
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
    # the registry board it was read from, so a listing that disappears can be closed
    job_source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("aa_job_sources.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )


class JobSource(Base):
    """One place jobs are read from, once for everyone: a company's board on an applicant tracking
    system (Greenhouse, Lever, Ashby, ...) or a public feed. Read on its own schedule, which slows
    down for boards that rarely change and speeds up for busy ones."""

    __tablename__ = "aa_job_sources"
    __table_args__ = (
        UniqueConstraint("kind", "board"),
        Index("ix_aa_job_sources_due", "enabled", "next_sync_at"),
    )
    id: Mapped[uuid.UUID] = _pk()
    kind: Mapped[str] = mapped_column(String(30))  # greenhouse | lever | ashby | remotive | ...
    board: Mapped[str] = mapped_column(String(120), default="")  # "" for a whole feed
    company: Mapped[str | None] = mapped_column(String(200), nullable=True)
    domain: Mapped[str | None] = mapped_column(String(253), nullable=True)
    origin: Mapped[str] = mapped_column(String(12), default="settings")  # settings | startup
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    every_minutes: Mapped[int] = mapped_column(Integer, default=360)
    next_sync_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    last_synced_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    last_changed_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    jobs_listed: Mapped[int] = mapped_column(Integer, default=0)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    health: Mapped[str] = mapped_column(String(10), default="new")  # new | ok | failing
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


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
    posting_id: Mapped[uuid.UUID] = _fk("aa_postings.id", index=True)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("aa_campaigns.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
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
    posting_id: Mapped[uuid.UUID] = _fk("aa_postings.id", index=True)
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("aa_applications.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
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


class RecruitingEvent(Base):
    """Something an employer sent about an application, read from the candidate's mailbox. Only
    evidence is kept (who, which subject, what kind, when): the message itself stays in the
    mailbox and no body text is stored."""

    __tablename__ = "aa_recruiting_events"
    __table_args__ = (UniqueConstraint("mailbox_id", "provider_message_id"),)
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    mailbox_id: Mapped[uuid.UUID] = _fk("aa_mailboxes.id")
    provider_message_id: Mapped[str] = mapped_column(String(200))
    thread_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # acknowledgment | assessment | shortlist | invitation | confirmation | reschedule |
    # cancellation | rejection
    kind: Mapped[str] = mapped_column(String(14))
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("aa_applications.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(14), default="matched")
    # matched | needs_review | dismissed
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    links: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)  # scheduling / meeting
    scheduled_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    time_zone_unclear: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    round: Mapped[int | None] = mapped_column(Integer, nullable=True)
    received_at: Mapped[datetime] = mapped_column(_TS)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class InterviewLink(Base):
    """An interview with an employer, tied to the application that led to it and to a company in
    the interview-preparation part of the app. One per application and round, however many
    messages (invitation, confirmation, reschedule, repeat) mention it."""

    __tablename__ = "aa_interviews"
    __table_args__ = (UniqueConstraint("application_id", "round"),)
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    application_id: Mapped[uuid.UUID] = _fk("aa_applications.id")
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    round: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(10), default="invited")
    # invited | scheduled | cancelled | completed
    scheduling_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    meeting_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    time_zone_unclear: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    last_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("aa_recruiting_events.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    history: Mapped[list[Any]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )  # [{kind, at, scheduled_at}]: reschedules and cancellations stay visible
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    updated_at: Mapped[datetime] = mapped_column(_TS, default=_now, onupdate=_now)


class KillSwitch(Base):
    """A switch an operator can flip without a deploy to stop new dispatches. Names: 'global',
    'channel:form|email|outreach', 'provider:<adapter name>'. Attempts already in flight are still
    settled."""

    __tablename__ = "aa_kill_switches"
    name: Mapped[str] = mapped_column(String(60), primary_key=True)
    on: Mapped[bool] = mapped_column(Boolean, default=True)
    reason: Mapped[str] = mapped_column(String(300), default="")
    set_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    set_at: Mapped[datetime] = mapped_column(_TS, default=_now)


# ---------------------------------------------------------------- startup outreach


class Startup(Base):
    """A company read from an accelerator's public directory. Shared by every candidate: the
    facts are public, so each is researched once."""

    __tablename__ = "aa_startups"
    __table_args__ = (
        Index("ix_aa_startups_status_region", "status", "region"),
        Index("ix_aa_startups_directory", "directory"),
    )
    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(200))
    domain: Mapped[str] = mapped_column(String(253), unique=True)
    website: Mapped[str] = mapped_column(String(500))
    directory: Mapped[str] = mapped_column(String(120))  # which accelerator listed it
    directory_url: Mapped[str] = mapped_column(String(500))
    batch: Mapped[str | None] = mapped_column(String(60), nullable=True)
    one_liner: Mapped[str] = mapped_column(String(500), default="")
    sector: Mapped[str | None] = mapped_column(String(120), nullable=True)
    region: Mapped[str] = mapped_column(String(8), default="other")  # us | eu | uk | other
    country: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="new")  # new | researched | dead
    research: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    researched_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class StartupContact(Base):
    """A way to reach a startup that the startup itself published, with the page it came from.
    Nothing is guessed, bought or derived."""

    __tablename__ = "aa_startup_contacts"
    __table_args__ = (UniqueConstraint("startup_id", "email"),)
    id: Mapped[uuid.UUID] = _pk()
    startup_id: Mapped[uuid.UUID] = _fk("aa_startups.id", index=True)
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    kind: Mapped[str] = mapped_column(String(8))  # person | role (jobs@, careers@) | general
    source_url: Mapped[str] = mapped_column(String(500))
    found_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class HuntSettings(Base):
    """A candidate's own choices for startup outreach. Off until they turn it on."""

    __tablename__ = "aa_hunt_settings"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    regions: Mapped[list[str]] = mapped_column(JSONB, default=list)  # us | eu | uk
    roles: Mapped[list[str]] = mapped_column(JSONB, default=list)  # what they want to be hired as
    pitch: Mapped[str] = mapped_column(Text, default="")  # their own value proposition
    daily_cap: Mapped[int] = mapped_column(Integer, default=8)
    auto_send: Mapped[bool] = mapped_column(Boolean, default=False)  # false: approve each one
    sender_name: Mapped[str] = mapped_column(String(120), default="")
    postal_address: Mapped[str] = mapped_column(String(300), default="")  # CAN-SPAM
    updated_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class HuntTarget(Base):
    """One note to one published contact at one startup, from one candidate."""

    __tablename__ = "aa_hunt_targets"
    __table_args__ = (
        UniqueConstraint("user_id", "contact_id", "step"),
        Index("ix_aa_hunt_targets_user_status", "user_id", "status"),
    )
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id", index=True)
    startup_id: Mapped[uuid.UUID] = _fk("aa_startups.id", index=True)
    contact_id: Mapped[uuid.UUID] = _fk("aa_startup_contacts.id", index=True)
    step: Mapped[int] = mapped_column(Integer, default=1)  # 1 first note, 2 one follow-up
    fit: Mapped[int] = mapped_column(Integer, default=0)
    fit_reasons: Mapped[list[str]] = mapped_column(JSONB, default=list)
    openings: Mapped[list[dict[str, str]]] = mapped_column(JSONB, default=list)  # matching roles
    subject: Mapped[str] = mapped_column(String(300), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="drafted")
    # drafted | approved | sending | sent | failed | skipped | replied | declined
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    message_id: Mapped[str | None] = mapped_column(String(300), nullable=True)
    thread_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class Suppression(Base):
    """An address or domain nobody may write to again. user_id empty means for every candidate."""

    __tablename__ = "aa_suppressions"
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, index=True)
    domain: Mapped[str | None] = mapped_column(String(253), nullable=True, index=True)
    reason: Mapped[str] = mapped_column(String(12))  # opt_out | bounce | declined | manual
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


class Directory(Base):
    """An accelerator's public directory page we read startups from. The built-in ones can be
    turned off but not deleted; an operator can add more."""

    __tablename__ = "aa_directories"
    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(120), unique=True)
    url: Mapped[str] = mapped_column(String(500))
    region_hint: Mapped[str] = mapped_column(String(8), default="")  # for pages with no country
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    last_run_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    last_found: Mapped[int] = mapped_column(Integer, default=0)
    last_added: Mapped[int] = mapped_column(Integer, default=0)
    last_problem: Mapped[str | None] = mapped_column(String(300), nullable=True)
    cursor: Mapped[str | None] = mapped_column(String(500), nullable=True)  # next page to read
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)


# ------------------------------------------------------------------------------ background work
# One durable queue for everything the background worker does. A task is claimed in a short
# transaction (FOR UPDATE SKIP LOCKED) and then run outside it; its lease is renewed while it runs,
# and a lease that runs out means the worker died, so the task is given back.


class BgTask(Base):
    __tablename__ = "bg_tasks"
    __table_args__ = (
        # what the dispatcher asks for: queued work that is due, most urgent first
        Index("ix_bg_tasks_claim", "status", "priority", "run_at"),
        # at most one waiting or running task per key; a finished one does not block the next
        Index(
            "uq_bg_tasks_live_key",
            "idempotency_key",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
        Index("ix_bg_tasks_lease", "status", "lease_until"),
    )
    id: Mapped[uuid.UUID] = _pk()
    kind: Mapped[str] = mapped_column(String(60))
    priority: Mapped[int] = mapped_column(Integer, default=20)  # lower runs first
    # queued | running | done | failed (will retry) | dead (gave up) | cancelled
    status: Mapped[str] = mapped_column(String(10), default="queued")
    resource: Mapped[str] = mapped_column(String(10), default="light")
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    application_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    run_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=300)
    lease_until: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    locked_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    error_class: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    started_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)
    run_seconds: Mapped[float | None] = mapped_column(nullable=True)  # for cost by kind


class BgSchedule(Base):
    """When each recurring job next falls due. Kept in the database so a restart neither skips nor
    repeats one, and so only one of several workers fires it (the row is locked while it does)."""

    __tablename__ = "bg_schedules"
    name: Mapped[str] = mapped_column(String(60), primary_key=True)
    every_seconds: Mapped[int] = mapped_column(Integer)
    next_run_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    last_run_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)


# ---------------------------------------------------------------- support


class SupportTicket(Base):
    """A person asking the team for help. One thread of messages; staff answer it in the back
    office. Deleted with the account."""

    __tablename__ = "support_tickets"
    __table_args__ = (
        Index("ix_support_tickets_user", "user_id", "updated_at"),
        Index("ix_support_tickets_status", "status", "updated_at"),
    )
    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    subject: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(16), default="question")
    # open: waiting for the team | answered: waiting for the person | resolved | closed
    status: Mapped[str] = mapped_column(String(10), default="open", server_default="open")
    # which app and version it was sent from, and the page, so staff can reproduce a problem
    context: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    unread_for_user: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    unread_for_staff: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    updated_at: Mapped[datetime] = mapped_column(_TS, default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(_TS, nullable=True)


class SupportMessage(Base):
    __tablename__ = "support_messages"
    __table_args__ = (Index("ix_support_messages_ticket", "ticket_id", "created_at"),)
    id: Mapped[uuid.UUID] = _pk()
    ticket_id: Mapped[uuid.UUID] = _fk("support_tickets.id")
    # user: the person | staff: a reply they see | note: staff only, never shown to the person
    kind: Mapped[str] = mapped_column(String(6))
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(_TS, default=_now)
