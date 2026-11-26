"""Everything a handler may need, built once when the worker starts."""

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.adapters.interfaces import LlmProvider
from app.autoapply.adapters import DiscoveryAdapter, FormAdapter, MailboxAdapter
from app.config import Settings


@dataclass
class WorkerContext:
    maker: async_sessionmaker[AsyncSession]
    settings: Settings
    sources: list[DiscoveryAdapter] = field(default_factory=list)
    form: FormAdapter | None = None
    mailbox: MailboxAdapter | None = None
    llm: LlmProvider | None = None
    extra: dict[str, Any] = field(default_factory=dict)  # e.g. a fetcher, for tests
