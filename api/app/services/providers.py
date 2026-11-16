"""Builds the real providers and the research runner from settings."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.fakes import ScriptedAnswerLlm, ScriptedStt
from app.adapters.interfaces import LlmProvider, SttProvider
from app.adapters.openai_provider import OpenAILlm, OpenAISearch, UnconfiguredProvider, make_client
from app.adapters.openai_realtime import OpenAIRealtimeStt, UnconfiguredStt
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


FAKE_CAPTIONS = [
    "Tell me about a time you led a project under a tight deadline?",
    "Why do you want to work here?",
]


def build_stt(settings: Settings) -> SttProvider:
    if settings.use_fake_providers:
        return ScriptedStt(FAKE_CAPTIONS, seconds_per_line=2.0, rate=settings.stt_sample_rate)
    key = settings.openai_api_key.get_secret_value()
    if not key:
        return UnconfiguredStt()
    return OpenAIRealtimeStt(
        key,
        model=settings.openai_stt_model,
        url=settings.openai_realtime_url,
        protocol=settings.openai_realtime_protocol,
        fallback_model=settings.openai_stt_fallback_model,
    )


def build_answer_llm(settings: Settings) -> LlmProvider:
    if settings.use_fake_providers:
        return ScriptedAnswerLlm()
    key = settings.openai_api_key.get_secret_value()
    if not key:
        return UnconfiguredProvider()
    return OpenAILlm(
        make_client(key),
        answer_model=settings.openai_answer_model,
        research_model=settings.openai_research_model,
    )
