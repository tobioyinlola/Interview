"""All SQL lives here. User-owned aggregates are reached only through a repository constructed with
the owner's id, so every query is filtered by owner by construction (routers never touch the DB)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AudioToken,
    AuthSession,
    Company,
    CompanyBrief,
    CompanySource,
    IdempotencyKey,
    LoginToken,
    Note,
    PracticeSession,
    ResearchJob,
    Score,
    Suggestion,
    Usage,
    User,
    Utterance,
)
from app.security import hash_token, new_token


def _now() -> datetime:
    return datetime.now(UTC)


class AuthRepo:
    """Pre-authentication data (login tokens, cookie sessions). Not user-scoped by nature."""

    def __init__(self, db: AsyncSession, secret: str) -> None:
        self.db = db
        self.secret = secret

    async def recent_login_requests(self, email: str, *, within: timedelta) -> int:
        stmt = (
            select(func.count())
            .select_from(LoginToken)
            .where(LoginToken.email == email, LoginToken.created_at > _now() - within)
        )
        return int((await self.db.execute(stmt)).scalar_one())

    async def create_login_token(self, email: str, *, ttl: timedelta) -> str:
        token = new_token()
        self.db.add(
            LoginToken(
                email=email, token_hash=hash_token(token, self.secret), expires_at=_now() + ttl
            )
        )
        await self.db.commit()
        return token

    async def consume_login_token(self, token: str) -> str | None:
        """Atomically mark a valid unused token as used and return its email, else None."""
        stmt = (
            update(LoginToken)
            .where(
                LoginToken.token_hash == hash_token(token, self.secret),
                LoginToken.used_at.is_(None),
                LoginToken.expires_at > _now(),
            )
            .values(used_at=_now())
            .returning(LoginToken.email)
        )
        email = (await self.db.execute(stmt)).scalar_one_or_none()
        await self.db.commit()
        return email

    async def get_or_create_user(self, email: str) -> User:
        user = (await self.db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user:
            return user
        user = User(email=email)
        self.db.add(user)
        try:
            await self.db.commit()
        except IntegrityError:  # created concurrently by another request
            await self.db.rollback()
            return (await self.db.execute(select(User).where(User.email == email))).scalar_one()
        return user

    async def create_session(self, user_id: uuid.UUID, *, ttl: timedelta) -> str:
        token = new_token()
        self.db.add(
            AuthSession(
                user_id=user_id, token_hash=hash_token(token, self.secret), expires_at=_now() + ttl
            )
        )
        await self.db.commit()
        return token

    async def user_for_session(self, token: str) -> User | None:
        stmt = (
            select(User)
            .join(AuthSession, AuthSession.user_id == User.id)
            .where(
                AuthSession.token_hash == hash_token(token, self.secret),
                AuthSession.expires_at > _now(),
            )
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def delete_session(self, token: str) -> None:
        await self.db.execute(
            delete(AuthSession).where(AuthSession.token_hash == hash_token(token, self.secret))
        )
        await self.db.commit()


class AccountRepo:
    def __init__(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        self.db = db
        self.user_id = user_id

    async def delete_everything(self) -> None:
        """Delete the user; ON DELETE CASCADE removes every row they own, in one transaction."""
        await self.db.execute(delete(User).where(User.id == self.user_id))
        await self.db.commit()


class NotesRepo:
    def __init__(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        self.db = db
        self.user_id = user_id

    async def get(self) -> Note | None:
        stmt = select(Note).where(Note.user_id == self.user_id)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def upsert(self, *, role: str, content: str) -> Note:
        note = await self.get()
        if note is None:
            note = Note(user_id=self.user_id, role=role, content=content)
            self.db.add(note)
        else:
            note.role = role
            note.content = content
            note.updated_at = _now()
        await self.db.commit()
        await self.db.refresh(note)
        return note


ACTIVE_JOB = ("queued", "reading_pages", "searching", "writing")


class CompaniesRepo:
    """Companies and everything under them. Every method checks ownership first."""

    def __init__(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        self.db = db
        self.user_id = user_id

    async def get(self, company_id: uuid.UUID) -> Company | None:
        stmt = select(Company).where(Company.id == company_id, Company.user_id == self.user_id)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def list_all(self) -> list[tuple[Company, str | None]]:
        """Companies with the status of each one's latest research job."""
        companies = (
            (
                await self.db.execute(
                    select(Company)
                    .where(Company.user_id == self.user_id)
                    .order_by(Company.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        if not companies:
            return []
        latest = (
            await self.db.execute(
                select(ResearchJob.company_id, ResearchJob.status)
                .where(ResearchJob.company_id.in_([c.id for c in companies]))
                .ext(distinct_on(ResearchJob.company_id))
                .order_by(ResearchJob.company_id, ResearchJob.started_at.desc())
            )
        ).all()
        status_by_company = {cid: st for cid, st in latest}
        return [(c, status_by_company.get(c.id)) for c in companies]

    async def create(self, **fields: Any) -> Company:
        company = Company(user_id=self.user_id, **fields)
        self.db.add(company)
        await self.db.flush()
        return company

    async def delete(self, company_id: uuid.UUID) -> bool:
        res = await self.db.execute(
            delete(Company).where(Company.id == company_id, Company.user_id == self.user_id)
        )
        await self.db.commit()
        return (res.rowcount or 0) > 0  # type: ignore[attr-defined]

    async def current_brief(self, company_id: uuid.UUID) -> CompanyBrief | None:
        if await self.get(company_id) is None:
            return None
        stmt = select(CompanyBrief).where(
            CompanyBrief.company_id == company_id, CompanyBrief.is_current.is_(True)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def save_brief_content(
        self, company_id: uuid.UUID, content: dict[str, Any]
    ) -> CompanyBrief | None:
        """Store an edited brief. In place if no session used it; as a NEW version if one did, so a
        past session keeps the exact brief it was given."""
        row = await self.current_brief(company_id)
        if row is None:
            return None
        used = (
            await self.db.execute(
                select(func.count())
                .select_from(PracticeSession)
                .where(PracticeSession.brief_id == row.id)
            )
        ).scalar_one()
        if not used:
            row.content = content
            await self.db.commit()
            return row
        row.is_current = False
        await self.db.flush()
        new = CompanyBrief(
            company_id=company_id, version=row.version + 1, content=content, is_current=True
        )
        self.db.add(new)
        await self.db.commit()
        return new

    async def latest_job(self, company_id: uuid.UUID) -> ResearchJob | None:
        stmt = (
            select(ResearchJob)
            .where(ResearchJob.company_id == company_id, ResearchJob.user_id == self.user_id)
            .order_by(ResearchJob.started_at.desc())
            .limit(1)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def active_job(self, company_id: uuid.UUID) -> ResearchJob | None:
        job = await self.latest_job(company_id)
        return job if job is not None and job.status in ACTIVE_JOB else None

    def add_job(self, company_id: uuid.UUID, *, refresh: bool) -> ResearchJob:
        job = ResearchJob(
            company_id=company_id,
            user_id=self.user_id,
            status="queued",
            refresh=refresh,
            heartbeat_at=datetime.now(UTC),
        )
        self.db.add(job)
        return job

    async def sources(self, company_id: uuid.UUID) -> list[CompanySource]:
        if await self.get(company_id) is None:
            return []
        stmt = (
            select(CompanySource)
            .where(CompanySource.company_id == company_id, CompanySource.removed_by_user.is_(False))
            .order_by(CompanySource.kind, CompanySource.title)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def add_pasted_source(
        self, company_id: uuid.UUID, *, title: str, text: str
    ) -> CompanySource:
        src = CompanySource(
            company_id=company_id,
            kind="pasted",
            title=title.strip() or "Pasted text",
            status="ok",
            extracted_text=text,
            fetched_at=datetime.now(UTC),
        )
        self.db.add(src)
        await self.db.commit()
        await self.db.refresh(src)
        return src

    async def remove_source(self, company_id: uuid.UUID, source_id: uuid.UUID) -> bool:
        """Hide a source and drop it from the current brief (researched facts that cited only it
        go; the user's own facts stay)."""
        if await self.get(company_id) is None:
            return False
        res = await self.db.execute(
            update(CompanySource)
            .where(CompanySource.id == source_id, CompanySource.company_id == company_id)
            .values(removed_by_user=True)
        )
        found = (res.rowcount or 0) > 0  # type: ignore[attr-defined]
        await self.db.commit()
        if found:
            brief = await self.current_brief(company_id)
            if brief is not None:
                from app.schemas.brief import BriefContent
                from app.services.brief_edit import remove_source as drop

                content = drop(BriefContent.model_validate(brief.content), source_id)
                await self.save_brief_content(company_id, content.model_dump(mode="json"))
        return found


class UsageRepo:
    def __init__(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        self.db = db
        self.user_id = user_id

    async def consume_research_job(self, cap: int) -> bool:
        """Count one research job against today's cap in a single atomic statement, so parallel
        requests cannot slip past the limit. False means the cap is reached."""
        today = datetime.now(UTC).date()
        stmt = (
            pg_insert(Usage)
            .values(user_id=self.user_id, day=today, research_jobs=1)
            .on_conflict_do_update(
                index_elements=[Usage.user_id, Usage.day],
                set_={"research_jobs": Usage.research_jobs + 1},
                where=Usage.research_jobs < cap,
            )
            .returning(Usage.research_jobs)
        )
        if cap < 1:
            return False
        return (await self.db.execute(stmt)).scalar_one_or_none() is not None


class SessionsRepo:
    def __init__(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        self.db = db
        self.user_id = user_id

    async def create(
        self,
        *,
        consent_confirmed_at: datetime,
        company_id: uuid.UUID | None,
        brief_id: uuid.UUID | None,
        role: str,
        notes_snapshot: str,
    ) -> PracticeSession:
        row = PracticeSession(
            user_id=self.user_id,
            company_id=company_id,
            brief_id=brief_id,
            consent_confirmed_at=consent_confirmed_at,
            role=role,
            notes_snapshot=notes_snapshot,
            status="active",
        )
        self.db.add(row)
        await self.db.flush()
        return row

    async def get(self, session_id: uuid.UUID) -> PracticeSession | None:
        stmt = select(PracticeSession).where(
            PracticeSession.id == session_id, PracticeSession.user_id == self.user_id
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()


class IdempotencyRepo:
    def __init__(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        self.db = db
        self.user_id = user_id

    async def find(self, key: str, route: str) -> dict[str, Any] | None:
        stmt = select(IdempotencyKey.response).where(
            IdempotencyKey.user_id == self.user_id,
            IdempotencyKey.key == key,
            IdempotencyKey.route == route,
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    def add(self, key: str, route: str, response: dict[str, Any]) -> None:
        self.db.add(IdempotencyKey(user_id=self.user_id, key=key, route=route, response=response))


class AudioTokenRepo:
    def __init__(self, db: AsyncSession, secret: str) -> None:
        self.db = db
        self.secret = secret

    async def issue(self, user_id: uuid.UUID, session_id: uuid.UUID, *, ttl: timedelta) -> str:
        token = new_token()
        self.db.add(
            AudioToken(
                user_id=user_id,
                session_id=session_id,
                token_hash=hash_token(token, self.secret),
                expires_at=_now() + ttl,
            )
        )
        await self.db.commit()
        return token

    async def consume(self, token: str, session_id: uuid.UUID) -> uuid.UUID | None:
        """Atomically spend a valid token for this session; returns the user id, else None.
        A second use, an expired token, or another session's token all return None."""
        stmt = (
            update(AudioToken)
            .where(
                AudioToken.token_hash == hash_token(token, self.secret),
                AudioToken.session_id == session_id,
                AudioToken.used_at.is_(None),
                AudioToken.expires_at > _now(),
            )
            .values(used_at=_now())
            .returning(AudioToken.user_id)
        )
        user_id = (await self.db.execute(stmt)).scalar_one_or_none()
        await self.db.commit()
        return user_id


class LiveRepo:
    """Rows written while a session is live. Constructed with the owner's id, like the others."""

    def __init__(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        self.db = db
        self.user_id = user_id

    async def active_session(self, session_id: uuid.UUID) -> PracticeSession | None:
        row = await SessionsRepo(self.db, self.user_id).get(session_id)
        return row if row is not None and row.status == "active" else None

    async def max_seq(self, session_id: uuid.UUID) -> int:
        stmt = select(func.coalesce(func.max(Utterance.seq), 0)).where(
            Utterance.session_id == session_id
        )
        return int((await self.db.execute(stmt)).scalar_one())

    async def save_utterance(
        self,
        session_id: uuid.UUID,
        *,
        seq: int,
        speaker: str,
        text: str,
        started_at: datetime | None,
        ended_at: datetime,
        utterance_id: uuid.UUID | None = None,
    ) -> uuid.UUID:
        """Insert once. A repeated write of the same (session, seq), such as after a reconnect,
        is harmless and returns the existing row's id."""
        if await SessionsRepo(self.db, self.user_id).get(session_id) is None:
            raise PermissionError("session not owned")
        stmt = (
            pg_insert(Utterance)
            .values(
                id=utterance_id or uuid.uuid4(),
                session_id=session_id,
                seq=seq,
                speaker=speaker,
                text=text,
                started_at=started_at,
                ended_at=ended_at,
            )
            .on_conflict_do_nothing(index_elements=[Utterance.session_id, Utterance.seq])
            .returning(Utterance.id)
        )
        new_id = (await self.db.execute(stmt)).scalar_one_or_none()
        if new_id is None:
            new_id = (
                await self.db.execute(
                    select(Utterance.id).where(
                        Utterance.session_id == session_id, Utterance.seq == seq
                    )
                )
            ).scalar_one()
        await self.db.commit()
        return new_id

    async def utterances(self, session_id: uuid.UUID) -> list[Utterance]:
        if await SessionsRepo(self.db, self.user_id).get(session_id) is None:
            return []
        stmt = select(Utterance).where(Utterance.session_id == session_id).order_by(Utterance.seq)
        return list((await self.db.execute(stmt)).scalars().all())

    async def recent_utterances(
        self, session_id: uuid.UUID, ids: list[uuid.UUID], limit: int = 3
    ) -> list[Utterance]:
        """The utterances a suggest request names, only from this user's session, in order."""
        if not ids or await SessionsRepo(self.db, self.user_id).get(session_id) is None:
            return []
        stmt = (
            select(Utterance)
            .where(Utterance.session_id == session_id, Utterance.id.in_(ids))
            .order_by(Utterance.seq)
            .limit(limit)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def suggestions(self, session_id: uuid.UUID) -> list[Suggestion]:
        if await SessionsRepo(self.db, self.user_id).get(session_id) is None:
            return []
        stmt = (
            select(Suggestion)
            .where(Suggestion.session_id == session_id)
            .order_by(Suggestion.created_at)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def saved_suggestion(
        self, session_id: uuid.UUID, utterance_id: uuid.UUID | None, question: str
    ) -> Suggestion | None:
        """A repeat request for the same question returns the saved outline, free."""
        if await SessionsRepo(self.db, self.user_id).get(session_id) is None:
            return None
        stmt = select(Suggestion).where(Suggestion.session_id == session_id)
        if utterance_id is not None:
            stmt = stmt.where(Suggestion.utterance_id == utterance_id)
        else:
            stmt = stmt.where(Suggestion.question_text == question)
        return (await self.db.execute(stmt.limit(1))).scalar_one_or_none()

    async def set_feedback(self, suggestion_id: uuid.UUID, value: str) -> bool:
        """Thumbs up or down on an outline, only on the owner's own sessions."""
        owned = select(PracticeSession.id).where(PracticeSession.user_id == self.user_id)
        res = await self.db.execute(
            update(Suggestion)
            .where(Suggestion.id == suggestion_id, Suggestion.session_id.in_(owned))
            .values(feedback=value)
        )
        await self.db.commit()
        return (res.rowcount or 0) > 0  # type: ignore[attr-defined]

    async def scores(self, session_id: uuid.UUID) -> list[Score]:
        if await SessionsRepo(self.db, self.user_id).get(session_id) is None:
            return []
        stmt = select(Score).where(Score.session_id == session_id).order_by(Score.id)
        rows = list((await self.db.execute(stmt)).scalars().all())
        # present in the order the answers were given
        order = {u.id: u.seq for u in await self.utterances(session_id)}
        return sorted(rows, key=lambda r: order.get(r.utterance_id, 0))

    async def begin_scoring(self, session_id: uuid.UUID) -> str:
        """Mark scoring as running unless it already is. Returns the status that applies."""
        res = await self.db.execute(
            update(PracticeSession)
            .where(
                PracticeSession.id == session_id,
                PracticeSession.user_id == self.user_id,
                PracticeSession.scoring_status != "running",
            )
            .values(scoring_status="running", scoring_error=None)
        )
        await self.db.commit()
        return "started" if (res.rowcount or 0) > 0 else "running"  # type: ignore[attr-defined]

    async def delete_session(self, session_id: uuid.UUID) -> bool:
        res = await self.db.execute(
            delete(PracticeSession).where(
                PracticeSession.id == session_id, PracticeSession.user_id == self.user_id
            )
        )
        await self.db.commit()
        return (res.rowcount or 0) > 0  # type: ignore[attr-defined]

    async def list_sessions(
        self, *, limit: int, cursor: tuple[datetime, uuid.UUID] | None
    ) -> list[tuple[PracticeSession, str | None, int]]:
        """Newest first, one page. Rows are (session, company name, number of outlines)."""
        count = (
            select(func.count(Suggestion.id))
            .where(Suggestion.session_id == PracticeSession.id)
            .correlate(PracticeSession)
            .scalar_subquery()
        )
        stmt = (
            select(PracticeSession, Company.name, count)
            .outerjoin(Company, Company.id == PracticeSession.company_id)
            .where(PracticeSession.user_id == self.user_id)
            .order_by(PracticeSession.started_at.desc(), PracticeSession.id.desc())
            .limit(limit)
        )
        if cursor is not None:
            t, i = cursor
            stmt = stmt.where(
                (PracticeSession.started_at < t)
                | ((PracticeSession.started_at == t) & (PracticeSession.id < i))
            )
        return [(r[0], r[1], int(r[2])) for r in (await self.db.execute(stmt)).all()]

    async def end_session(
        self, session_id: uuid.UUID, status: str = "ended"
    ) -> PracticeSession | None:
        row = await SessionsRepo(self.db, self.user_id).get(session_id)
        if row is None:
            return None
        if row.status == "active":
            row.status = status
            row.ended_at = _now()
            await self.db.commit()
        return row


class UsageMeterRepo:
    """Daily counters that drive the caps. All updates are single atomic upserts."""

    def __init__(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        self.db = db
        self.user_id = user_id

    async def today(self) -> Usage | None:
        stmt = select(Usage).where(Usage.user_id == self.user_id, Usage.day == _now().date())
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def stt_seconds_today(self) -> int:
        row = await self.today()
        return row.stt_seconds if row else 0

    async def tokens_today(self) -> int:
        row = await self.today()
        return (row.llm_input_tokens + row.llm_output_tokens) if row else 0

    async def add_stt_seconds(self, seconds: int) -> int:
        if seconds <= 0:
            return await self.stt_seconds_today()
        stmt = (
            pg_insert(Usage)
            .values(user_id=self.user_id, day=_now().date(), stt_seconds=seconds)
            .on_conflict_do_update(
                index_elements=[Usage.user_id, Usage.day],
                set_={"stt_seconds": Usage.stt_seconds + seconds},
            )
            .returning(Usage.stt_seconds)
        )
        total = (await self.db.execute(stmt)).scalar_one()
        await self.db.commit()
        return int(total)

    async def add_tokens(self, input_tokens: int, output_tokens: int) -> None:
        stmt = (
            pg_insert(Usage)
            .values(
                user_id=self.user_id,
                day=_now().date(),
                llm_input_tokens=input_tokens,
                llm_output_tokens=output_tokens,
            )
            .on_conflict_do_update(
                index_elements=[Usage.user_id, Usage.day],
                set_={
                    "llm_input_tokens": Usage.llm_input_tokens + input_tokens,
                    "llm_output_tokens": Usage.llm_output_tokens + output_tokens,
                },
            )
        )
        await self.db.execute(stmt)
        await self.db.commit()
