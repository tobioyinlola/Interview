"""All SQL lives here. User-owned aggregates are reached only through a repository constructed with
the owner's id, so every query is filtered by owner by construction (routers never touch the DB)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuthSession,
    Company,
    CompanyBrief,
    IdempotencyKey,
    LoginToken,
    Note,
    PracticeSession,
    User,
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


class CompaniesRepo:
    def __init__(self, db: AsyncSession, user_id: uuid.UUID) -> None:
        self.db = db
        self.user_id = user_id

    async def get(self, company_id: uuid.UUID) -> Company | None:
        stmt = select(Company).where(Company.id == company_id, Company.user_id == self.user_id)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def current_brief(self, company_id: uuid.UUID) -> CompanyBrief | None:
        # Owner check first: a brief is only reachable through a company the user owns.
        if await self.get(company_id) is None:
            return None
        stmt = select(CompanyBrief).where(
            CompanyBrief.company_id == company_id, CompanyBrief.is_current.is_(True)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()


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
