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
    kind: Mapped[str] = mapped_column(String(10))  # trial | referral | paid
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
