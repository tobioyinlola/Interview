"""Builds the real providers and the research runner from settings."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.openai_provider import OpenAILlm, OpenAISearch, UnconfiguredProvider, make_client
from app.config import Settings
from app.services.fetcher import Fetcher
from app.workers.research_worker import ResearchRunner


def build_fetcher(settings: Settings) -> Fetcher:
    return Fetcher(
        user_agent=settings.fetch_user_agent,
        timeout=settings.fetch_timeout_seconds,
        max_bytes=settings.fetch_max_bytes,
        max_redirects=settings.fetch_max_redirects,
        host_interval=settings.fetch_host_interval_seconds,
        text_max_chars=settings.source_text_max_chars,
    )


def build_runner(
    settings: Settings, session_factory: async_sessionmaker[AsyncSession]
) -> ResearchRunner:
    key = settings.openai_api_key.get_secret_value()
    llm: OpenAILlm | UnconfiguredProvider
    search: OpenAISearch | UnconfiguredProvider
    if key:
        client = make_client(key)
        llm = OpenAILlm(
            client,
            answer_model=settings.openai_answer_model,
            research_model=settings.openai_research_model,
        )
        search = OpenAISearch(client, model=settings.openai_research_model)
    else:
        llm = search = UnconfiguredProvider()
    return ResearchRunner(
        session_factory=session_factory,
        fetcher=build_fetcher(settings),
        llm=llm,
        search=search,
        settings=settings,
    )
