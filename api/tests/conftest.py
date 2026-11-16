import asyncio
import os
import re
from collections.abc import AsyncIterator, Callable

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

import app.models  # noqa: F401
from app.adapters.fakes import FakeSearchProvider
from app.config import Settings, get_settings
from app.db import Base, get_db, get_sessionmaker
from app.deps import get_email_sender, get_hub, get_resolver, get_runner, get_stt, get_suggester
from app.main import create_app
from app.services.live import LiveHub
from app.services.suggest import SuggestionService
from app.workers.research_worker import ResearchRunner
from tests.helpers import AnswerLlm, ControlledStt, FakeFetcher, ScriptedLlm, good_reply, ok

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
def fetcher():
    return FakeFetcher({"https://acme.com/": ok("https://acme.com/")})


@pytest.fixture
def llm():
    return ScriptedLlm(good_reply)


@pytest.fixture
def search():
    return FakeSearchProvider()


@pytest.fixture
def runner(engine, settings, fetcher, llm, search):
    return ResearchRunner(
        session_factory=async_sessionmaker(engine, expire_on_commit=False),
        fetcher=fetcher,  # type: ignore[arg-type]
        llm=llm,  # type: ignore[arg-type]
        search=search,
        settings=settings,
    )


@pytest.fixture
def stt():
    return ControlledStt()


@pytest.fixture
def answer_llm():
    return AnswerLlm()


@pytest.fixture
def hub():
    return LiveHub()


@pytest.fixture
def suggester(answer_llm, settings, engine):
    return SuggestionService(
        answer_llm,  # type: ignore[arg-type]
        settings,
        async_sessionmaker(engine, expire_on_commit=False),
    )


async def fake_resolver(host: str, port: int) -> list[str]:
    """Names starting with 'private' resolve to a private address; everything else is public."""
    return ["10.0.0.1"] if host.startswith("private") else ["93.184.216.34"]


@pytest.fixture
def app(engine, sender, settings, runner, stt, hub, suggester):
    application = create_app()
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _db() -> AsyncIterator[AsyncSession]:
        async with maker() as s:
            yield s

    application.dependency_overrides[get_db] = _db
    application.dependency_overrides[get_email_sender] = lambda: sender
    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_runner] = lambda: runner
    application.dependency_overrides[get_stt] = lambda: stt
    application.dependency_overrides[get_hub] = lambda: hub
    application.dependency_overrides[get_suggester] = lambda: suggester
    application.dependency_overrides[get_sessionmaker] = lambda: maker
    application.dependency_overrides[get_resolver] = lambda: fake_resolver
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


@pytest.fixture
async def live_server(app):
    """A real uvicorn server on a free port, in the test's event loop (so the async test engine
    works). Needed for WebSockets and for client disconnects, which ASGI test clients can't do."""
    import uvicorn

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    )
    task = asyncio.create_task(server.serve())
    async with asyncio.timeout(5):
        while not server.started:
            await asyncio.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    yield f"127.0.0.1:{port}"
    server.should_exit = True
    await task
