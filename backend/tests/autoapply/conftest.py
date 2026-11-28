"""Shared pieces for the Auto-Apply tests: the feature on, a clock the test moves, a signed-in
candidate with a CV, and a model that reads CVs."""

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
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


# ------------------------------------------------------------------ phase 2: discovery fixtures

from app.autoapply.adapters import RawPosting  # noqa: E402
from app.autoapply.fixtures import FIXTURE_HOST, FixtureDiscovery, FixtureForm  # noqa: E402
from app.routers.autoapply import get_form, get_sources  # noqa: E402


def job(n: int = 1, **over) -> RawPosting:
    """A listing that matches Ada's search unless a test changes something."""
    base = dict(
        source="fixture",
        source_url=f"https://board.fixture.test/jobs/{n}",
        company="Acme",
        title="Senior Product Manager",
        description="Lead payments product. Remote.",
        requisition_id=f"REQ-{n}",
        region="Nigeria",
        arrangement="remote",
        application_url=f"https://{FIXTURE_HOST}/acme/{n}",
        evidence={"region": "the listing's location line"},
    )
    base.update(over)
    return RawPosting(**base)


@pytest.fixture
def discovery_source() -> FixtureDiscovery:
    return FixtureDiscovery()


@pytest.fixture
def form() -> FixtureForm:
    return FixtureForm()


@pytest.fixture(autouse=True)
def adapters(app, discovery_source, form):
    app.dependency_overrides[get_sources] = lambda: [discovery_source]
    app.dependency_overrides[get_form] = lambda: form


async def start(c, **over) -> dict:
    """Profile saved (with any overrides), CV facts confirmed, campaign running."""
    assert (await c.put("/api/autoapply/profile", json={**PROFILE, **over})).status_code == 200
    await c.put("/api/autoapply/facts", json={"data": FACTS, "verified": True})
    r = await c.post(
        "/api/autoapply/campaign/enable", json={"policy_version": "2026-11", "accept": True}
    )
    assert r.status_code == 201, r.text
    return r.json()


async def run(c) -> dict:
    r = await c.post("/api/autoapply/discovery/run")
    assert r.status_code == 200, r.text
    return r.json()


async def apps(c, status: str | None = None) -> list[dict]:
    q = f"?status={status}" if status else ""
    return (await c.get(f"/api/autoapply/applications{q}")).json()["items"]


# ------------------------------------------------------------------ phase 3: sending fixtures

from app.autoapply import scheduler  # noqa: E402
from app.autoapply.fixtures import FixtureMailbox  # noqa: E402
from app.routers.autoapply import get_mailbox_adapter  # noqa: E402


@pytest.fixture
def mailbox() -> FixtureMailbox:
    return FixtureMailbox()


@pytest.fixture(autouse=True)
def mailbox_adapter(app, mailbox):
    app.dependency_overrides[get_mailbox_adapter] = lambda: mailbox


@pytest.fixture
def tick(maker, settings, discovery_source, form, mailbox, cv_llm, clock):
    """Run one pass of the background scheduler at the test clock's time."""

    async def _tick(now=None):
        return await scheduler.tick(
            maker,
            now or clock.now,
            settings=settings,
            sources=[discovery_source],
            form=form,
            mailbox_adapter=mailbox,
            llm=cv_llm,
        )

    return _tick


@pytest.fixture
def outbox_adapters(settings, form, mailbox):
    from app.autoapply.outbox import Adapters

    return Adapters(form=form, mailbox=mailbox, settings=settings)


def email_job(n: int = 1, **over) -> RawPosting:
    """A listing whose only way to apply is an email address, with the evidence that it says so."""
    base = dict(
        application_url=None,
        apply_email=f"jobs{n}@acme.test",
        apply_instructions="Email your CV. Subject: PM application",
        evidence={
            "apply_email": "How to apply: email jobs@acme.test",
            "region": "the location line",
        },
    )
    base.update(over)
    return job(n, **base)


async def connect_mailbox(c, *, email=True, outreach=False, form_on=True):
    r = await c.post("/api/autoapply/mailbox/connect")
    assert r.status_code == 200 and r.json()["connected"] is True, r.text
    ch = {"form": form_on, "email": email, "outreach": outreach}
    assert (await c.put("/api/autoapply/profile", json={"channels": ch})).status_code == 200


async def user_id(maker):
    from app.models import User

    async with maker() as db:
        return (await db.execute(select(User.id))).scalars().first()


@pytest.fixture(autouse=True)
def mail_domains_work(monkeypatch):
    """No test asks the real DNS whether a startup's domain receives mail."""
    from app.hunt import engine

    async def works(domain: str) -> bool | None:
        return True

    monkeypatch.setattr(engine, "RESOLVER", works)
