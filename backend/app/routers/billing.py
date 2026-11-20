"""Session credits and the invite reward. Payments themselves do not exist yet: a person with no
credit is told so, and `payments_enabled` stays false until they do."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import User
from app.repositories import BillingRepo
from app.schemas.api import BillingOut

router = APIRouter(prefix="/api", tags=["billing"])

PAYMENTS_ENABLED = False


async def billing_out(db: AsyncSession, user: User, settings: Settings) -> BillingOut:
    per = max(1, settings.referrals_per_free_session)
    s = await BillingRepo(db, user, per_reward=per).summary()
    return BillingOut(
        sessions_available=s.trial_available + s.referral_available + s.paid_available,
        trial_available=s.trial_available > 0,
        referral_credits_available=s.referral_available,
        paid_credits_available=s.paid_available,
        payments_enabled=PAYMENTS_ENABLED,
        referral_code=user.referral_code or "",
        referral_link=f"{settings.web_origin}/signup?ref={user.referral_code}",
        referrals_qualified=s.referrals_qualified,
        referrals_held=s.referrals_held,
        referrals_per_reward=per,
        referrals_to_next_reward=per - (s.referrals_qualified % per),
        rewards_earned=s.rewards_earned,
        rewards_redeemable=max(0, s.rewards_earned - s.rewards_redeemed),
    )


@router.get("/billing")
async def get_billing(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> BillingOut:
    return await billing_out(db, user, settings)


@router.post("/billing/redeem")
async def redeem_reward(
    user: User = Depends(current_user),  # noqa: B008
    db: AsyncSession = Depends(get_db),  # noqa: B008
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> BillingOut:
    """Turn an earned invite reward into a free session the person can use."""
    per = max(1, settings.referrals_per_free_session)
    if not await BillingRepo(db, user, per_reward=per).redeem_reward():
        raise ApiError(409, "nothing_to_redeem", "You have no invite reward to redeem yet.")
    return await billing_out(db, user, settings)
