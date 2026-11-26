"""How much the worker may run at once, per kind of resource, and whether the machine has room
for more heavy work right now."""

import asyncio
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass

from app.config import Settings
from app.workers.registry import HEAVY, RESOURCES


class Limits:
    """A slot count per resource class plus one overall cap. The dispatcher asks how many of each it
    may claim before claiming, so it never takes more work than it can start."""

    def __init__(self, settings: Settings) -> None:
        self.total = max(1, settings.worker_max_concurrent_tasks)
        self.per = {
            "light": self.total,
            "http": max(1, settings.worker_max_http_tasks),
            "ai": max(1, settings.worker_max_ai_requests),
            "email": max(1, settings.worker_max_email_tasks),
            "document": max(1, settings.worker_max_document_tasks),
            "browser": max(1, settings.worker_max_browser_sessions),
        }
        self.busy = dict.fromkeys(RESOURCES, 0)

    @property
    def running(self) -> int:
        return sum(self.busy.values())

    def free(self, resource: str) -> int:
        return max(0, min(self.per[resource] - self.busy[resource], self.total - self.running))

    def open_resources(self, heavy_ok: bool) -> tuple[str, ...]:
        return tuple(r for r in RESOURCES if self.free(r) > 0 and (heavy_ok or r not in HEAVY))

    def take(self, resource: str) -> None:
        self.busy[resource] += 1

    def give(self, resource: str) -> None:
        self.busy[resource] = max(0, self.busy[resource] - 1)


@dataclass
class Pressure:
    memory_fraction: float | None  # used / limit for this container, when known
    load_per_cpu: float | None


def _read(path: str) -> str | None:
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


def measure() -> Pressure:
    """Memory against the container's limit (cgroup v2, then v1), and the 1-minute load per CPU."""
    used = _read("/sys/fs/cgroup/memory.current") or _read(
        "/sys/fs/cgroup/memory/memory.usage_in_bytes"
    )
    limit = _read("/sys/fs/cgroup/memory.max") or _read(
        "/sys/fs/cgroup/memory/memory.limit_in_bytes"
    )
    frac = None
    if used and limit and used.isdigit() and limit.isdigit() and int(limit) < 1 << 60:
        frac = int(used) / int(limit)
    try:
        load = os.getloadavg()[0] / max(1, os.cpu_count() or 1)
    except OSError:
        load = None
    return Pressure(frac, load)


def heavy_allowed(settings: Settings, p: Pressure) -> bool:
    if p.memory_fraction is not None and p.memory_fraction >= settings.worker_memory_high_fraction:
        return False
    return not (p.load_per_cpu is not None and p.load_per_cpu >= settings.worker_load_high_per_cpu)


class AiGate:
    """Limits model calls across every task in the worker (MAX_CONCURRENT_AI_REQUESTS), whichever
    task makes them."""

    def __init__(self, inner: object, slots: int) -> None:
        self._inner = inner
        self._sem = asyncio.Semaphore(max(1, slots))

    async def generate_json(self, *, system: str, user: str, schema: dict[str, object]) -> str:
        async with self._sem:
            return await self._inner.generate_json(system=system, user=user, schema=schema)  # type: ignore[attr-defined,no-any-return]

    def stream_text(self, *, system: str, user: str, model: str | None = None):  # type: ignore[no-untyped-def]
        inner = self._inner
        sem = self._sem

        async def gen() -> AsyncIterator[str]:
            async with sem:
                async for d in inner.stream_text(system=system, user=user, model=model):  # type: ignore[attr-defined]
                    yield d

        return gen()

    def __getattr__(self, name: str) -> object:
        return getattr(self._inner, name)
