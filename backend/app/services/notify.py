"""Emails the platform sends on its own when something finishes or changes, from places that are
not a web request (the research and scoring jobs) or that act for someone else (telling an inviter a
friend joined). Everything here is best effort: a message that cannot be built or sent is logged and
dropped, and never breaks the work that triggered it."""

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.email import EmailSender
from app.config import Settings
from app.models import Company, Event, PracticeSession, Referral, Score, User
from app.services import email_templates as emails
from app.services.names import first_name

log = logging.getLogger("app.notify")


class Notifier:
    def __init__(
        self,
        sf: async_sessionmaker[AsyncSession],
        settings: Settings,
        sender: EmailSender,
    ) -> None:
        self.sf = sf
        self.settings = settings
        self.sender = sender
        self.brand = emails.Brand(
            web_origin=settings.web_origin, support_email=settings.support_email
        )

    async def _send(self, build, *args) -> None:  # type: ignore[no-untyped-def]
        try:
            await self.sender.send(build(self.brand, *args))
        except Exception as exc:
            log.warning("notification not sent", extra={"fields": {"error": type(exc).__name__}})

    async def _user(self, user_id: uuid.UUID) -> User | None:
        async with self.sf() as db:
            return await db.get(User, user_id)

    async def brief_ready(self, company_id: uuid.UUID) -> None:
        try:
            async with self.sf() as db:
                company = await db.get(Company, company_id)
                user = await db.get(User, company.user_id) if company else None
            if company and user:
                await self._send(
                    emails.brief_ready, user.email, user.full_name, company.name, str(company.id)
                )
        except Exception as exc:
            log.warning("brief email failed", extra={"fields": {"error": type(exc).__name__}})

    async def review_ready(self, session_id: uuid.UUID) -> None:
        try:
            async with self.sf() as db:
                session = await db.get(PracticeSession, session_id)
                user = await db.get(User, session.user_id) if session else None
                n, avg = (
                    (
                        await db.execute(
                            select(func.count(), func.avg(Score.overall)).where(
                                Score.session_id == session_id
                            )
                        )
                    ).one()
                    if session
                    else (0, None)
                )
            if session and user and n:
                await self._send(
                    emails.review_ready,
                    user.email,
                    user.full_name,
                    str(session_id),
                    int(n),
                    round(float(avg)) if avg is not None else None,
                )
        except Exception as exc:
            log.warning("review email failed", extra={"fields": {"error": type(exc).__name__}})

    async def friend_joined(self, referrer_id: uuid.UUID, friend_id: uuid.UUID) -> None:
        """Tell an inviter that someone counted. When that completes a set, also say they earned a
        free interview."""
        try:
            per = max(1, self.settings.referrals_per_free_session)
            async with self.sf() as db:
                referrer = await db.get(User, referrer_id)
                friend = await db.get(User, friend_id)
                counted = int(
                    (
                        await db.execute(
                            select(func.count())
                            .select_from(Referral)
                            .where(
                                Referral.referrer_id == referrer_id, Referral.status == "counted"
                            )
                        )
                    ).scalar_one()
                )
            if referrer is None:
                return
            if counted % per == 0:
                await self._send(emails.reward_earned, referrer.email, referrer.full_name, per)
            else:
                await self._send(
                    emails.friend_joined,
                    referrer.email,
                    referrer.full_name,
                    first_name(friend.full_name) if friend else None,
                    counted % per,
                    per,
                )
        except Exception as exc:
            log.warning("friend email failed", extra={"fields": {"error": type(exc).__name__}})

    async def trial_used(self, user_id: uuid.UUID) -> None:
        """Once, when the free interview is used up and nothing is left."""
        try:
            async with self.sf() as db:
                user = await db.get(User, user_id)
                already = (
                    await db.execute(
                        select(func.count())
                        .select_from(Event)
                        .where(
                            Event.user_id == user_id,
                            Event.kind == "email.sent",
                            Event.data["email_kind"].astext == "trial_used",
                        )
                    )
                ).scalar_one()
            if user and not already:
                await self._send(
                    emails.trial_used,
                    user.email,
                    user.full_name,
                    max(1, self.settings.referrals_per_free_session),
                )
        except Exception as exc:
            log.warning("trial email failed", extra={"fields": {"error": type(exc).__name__}})

    async def outreach_approved(self, user_id: uuid.UUID) -> None:
        user = await self._user(user_id)
        if user:
            await self._send(emails.outreach_approved, user.email, user.full_name)

    async def credit_granted(self, user_id: uuid.UUID, count: int, reason: str | None) -> None:
        user = await self._user(user_id)
        if user:
            await self._send(emails.credit_granted, user.email, user.full_name, count, reason)
