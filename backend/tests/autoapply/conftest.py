"""Shared pieces for the Auto-Apply tests: the feature on, a clock the test moves, a signed-in
candidate with a CV, and a model that reads CVs."""

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.adapters.fakes import FakeLlmProvider
from app.models import Note
from app.routers.autoapply import get_llm, get_now

CV = (
    "Ada Okoye\nada@example.com +234 801 234 5678\nlinkedin.com/in/adaokoye\n"
    "Senior Product Manager at Northwind (2021-2025): led payments roadmap, grew revenue 30%.\n"
    "Product Manager at Contoso (2018-2021)."
)

FACTS = {
    "contact": {
        "name": "Ada Okoye",
        "email": "ada@example.com",
        "phone": "+234 801 234 5678",
        "location": "Lagos, Nigeria",
    },
    "links": ["https://linkedin.com/in/adaokoye"],
    "skills": ["Product strategy", "Payments", "SQL"],
    "history": [
        {
            "title": "Senior Product Manager",
            "company": "Northwind",
            "start": "2021",
            "end": "2025",
            "summary": "Led payments roadmap, grew revenue 30%.",
        },
        {
            "title": "Product Manager",
            "company": "Contoso",
            "start": "2018",
            "end": "2021",
            "summary": "Shipped onboarding.",
        },
    ],
    "education": ["BSc Computer Science"],
}

PROFILE = {
    "criteria": {
        "roles": [{"value": "Senior Product Manager", "required": True}],
        "locations": [{"value": "Nigeria", "required": True}],
        "arrangement": [{"value": "remote", "required": True}],
    },
    "timezone": "Africa/Lagos",
    "channels": {"form": True, "email": False, "outreach": False},
    "daily_application_cap": 5,
}


class Clock:
    """The current time, moved by the test."""

    def __init__(self, start: datetime) -> None:
        self.now = start

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock(datetime(2026, 11, 2, 9, 0, tzinfo=UTC))  # a Monday, 10:00 in Lagos


@pytest.fixture
def cv_llm() -> FakeLlmProvider:
    return FakeLlmProvider(json_reply=json.dumps(FACTS))


@pytest.fixture(autouse=True)
def feature_on(app, settings, clock, cv_llm):
    settings.autoapply_enabled = True
    app.dependency_overrides[get_now] = lambda: clock.now
    app.dependency_overrides[get_llm] = lambda: cv_llm


@pytest.fixture
def maker(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def ada(new_client, sign_in, maker):
    """A signed-in candidate whose CV is already uploaded."""
    async with new_client() as c:
        me = (await sign_in(c, "ada@example.com")).json()
        async with maker() as db:
            db.add(Note(user_id=__import__("uuid").UUID(me["id"]), content=CV, role="PM"))
            await db.commit()
        yield c
