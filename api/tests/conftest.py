import os
import re
from collections.abc import AsyncIterator, Callable

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

import app.models  # noqa: F401
from app.config import Settings, get_settings
from app.db import Base, get_db
from app.deps import get_email_sender
from app.main import create_app

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/meetpractice_test"
)


class CapturingSender:
    def __init__(self) -> None:
        self.links: list[tuple[str, str]] = []

    async def send_login_link(self, email: str, link: str) -> None:
        self.links.append((email, link))

    def token_for(self, email: str) -> str:
        link = [lnk for e, lnk in self.links if e == email.lower()][-1]
        return re.search(r"token=([^&]+)", link).group(1)  # type: ignore[union-attr]


@pytest.fixture
async def engine():
    eng = create_async_engine(TEST_DB, poolclass=NullPool)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
async def db(engine) -> AsyncIterator[AsyncSession]:
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s


@pytest.fixture
def sender() -> CapturingSender:
    return CapturingSender()


@pytest.fixture
def settings() -> Settings:
    return Settings(environment="local", database_url=TEST_DB, cookie_secret="test-secret")  # type: ignore[arg-type]


@pytest.fixture
def app(engine, sender, settings):
    application = create_app()
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _db() -> AsyncIterator[AsyncSession]:
        async with maker() as s:
            yield s

    application.dependency_overrides[get_db] = _db
    application.dependency_overrides[get_email_sender] = lambda: sender
    application.dependency_overrides[get_settings] = lambda: settings
    return application


CSRF = {"x-requested-with": "meet-practice"}


@pytest.fixture
def new_client(app) -> Callable[[], httpx.AsyncClient]:
    """Each client has its own cookie jar, so two clients are two browsers."""

    def make() -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test", headers=CSRF
        )

    return make


@pytest.fixture
def sign_in(sender):
    async def _sign_in(client: httpx.AsyncClient, email: str) -> httpx.Response:
        r = await client.post("/api/auth/request-link", json={"email": email})
        assert r.status_code == 202
        v = await client.post("/api/auth/verify", json={"token": sender.token_for(email)})
        assert v.status_code == 200, v.text
        return v

    return _sign_in
