"""Words the speech-to-text and the answer writer should know about: the role's own terminology and
the company name. Product management terms are listed because that is what people practise most;
any other role falls back to "use the standard vocabulary of that role"."""

import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Company, PracticeSession, User

PRODUCT_TERMS = (
    "product roadmap, prioritisation, RICE, MoSCoW, product discovery, product-market fit, "
    "north star metric, OKRs, KPIs, MVP, PRD, user stories, acceptance criteria, backlog, "
    "sprint planning, stakeholder alignment, cross-functional, go-to-market, A/B testing, "
    "activation, retention, churn, conversion funnel, NPS, customer segments, jobs to be done, "
    "trade-offs, tech debt, launch, iteration, data-informed, ARR, unit economics"
)

# What each onboarding level means, in the words the answer writer is given.
LEVELS = {
    "entry": "early career (up to about 2 years)",
    "mid": "mid-level (about 3 to 5 years)",
    "senior": "senior (6 or more years)",
    "lead": "lead or executive (10 or more years, managing people or a function)",
}
DEFAULT_LEVEL = LEVELS["senior"]


def clean(text: str, limit: int) -> str:
    """One line, no markup characters, bounded: this text goes into a prompt."""
    return re.sub(r"\s+", " ", re.sub(r"[<>{}\[\]`]", " ", text or "")).strip()[:limit]


def is_product_role(role: str) -> bool:
    return "product" in (role or "").lower()


def role_terms(role: str) -> str:
    """Terminology to use naturally in answers for this role."""
    if is_product_role(role):
        return PRODUCT_TERMS
    return ""


def level_text(onboarding: dict[str, object] | None) -> str:
    level = (onboarding or {}).get("level")
    return LEVELS.get(level, DEFAULT_LEVEL) if isinstance(level, str) else DEFAULT_LEVEL


def stt_prompt(role: str, company: str) -> str:
    """A short hint that makes the transcriber spell names and jargon correctly."""
    bits = ["A job interview, spoken in English."]
    if role := clean(role, 80):
        bits.append(f"The role is {role}.")
    if company := clean(company, 80):
        bits.append(f"The company is {company}.")
    if terms := role_terms(role):
        bits.append(f"Terms that may come up: {terms}.")
    return " ".join(bits)[:900]


async def session_company(db: AsyncSession, session: PracticeSession) -> str:
    if session.company_id is None:
        return ""
    row = await db.get(Company, session.company_id)
    return row.name if row is not None and row.user_id == session.user_id else ""


async def session_stt_prompt(db: AsyncSession, session: PracticeSession) -> str:
    return stt_prompt(session.role, await session_company(db, session))


async def user_level(db: AsyncSession, user_id: uuid.UUID) -> str:
    user = await db.get(User, user_id)
    return level_text(user.onboarding if user is not None else None)
