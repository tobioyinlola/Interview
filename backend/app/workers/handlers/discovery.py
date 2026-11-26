"""Central job discovery in the worker: keep the registry of boards up to date, and read each
board when it falls due (see autoapply/registry.py)."""

import uuid

from app.autoapply import registry as boards
from app.autoapply.clock import utcnow
from app.models import BgTask
from app.workers.context import WorkerContext
from app.workers.queue import LOW
from app.workers.registry import Permanent, task


@task("discovery.registry", priority=LOW, timeout_seconds=300)
async def refresh_registry(ctx: WorkerContext, t: BgTask) -> None:
    """Register boards named in the settings and found on researched startups' careers pages."""
    async with ctx.maker() as db:
        await boards.seed(db, ctx.settings, utcnow())
        await db.commit()


@task("discovery.sync_source", resource="http", priority=LOW, timeout_seconds=300)
async def sync_source(ctx: WorkerContext, t: BgTask) -> None:
    """Read one board for everyone and update the stored jobs."""
    raw = (t.payload or {}).get("source")
    if not raw:
        raise Permanent("No board given.")
    reader = (ctx.extra.get("readers") or {}).get(raw)  # tests hand in a stand-in reader
    async with ctx.maker() as db:
        await boards.sync(db, uuid.UUID(raw), utcnow(), reader=reader)
