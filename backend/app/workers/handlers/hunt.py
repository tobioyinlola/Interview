"""Startup outreach in the worker: reading directories, researching startups, and each person's
drafting and sending, as separate tasks so one slow site never holds up anyone's sending."""

from app.autoapply.clock import utcnow
from app.hunt import directory, engine, jobs
from app.models import BgTask
from app.workers.context import WorkerContext
from app.workers.handlers.autoapply import _user
from app.workers.queue import CRITICAL, LOW, NORMAL
from app.workers.registry import task


def _fetcher(ctx: WorkerContext):  # type: ignore[no-untyped-def]
    f = ctx.extra.get("fetcher")
    if f is None:
        f = directory.page_reader()
        ctx.extra["fetcher"] = f
    return f


@task("hunt.directories", resource="http", priority=LOW, timeout_seconds=1200, max_attempts=2)
async def read_directories(ctx: WorkerContext, t: BgTask) -> None:
    await jobs.read_directories(ctx.maker, _fetcher(ctx), ctx.llm, utcnow())  # type: ignore[arg-type]


@task("hunt.research", resource="http", priority=LOW, timeout_seconds=900, max_attempts=2)
async def research(ctx: WorkerContext, t: BgTask) -> None:
    await jobs.research_pending(ctx.maker, _fetcher(ctx), ctx.llm, utcnow())  # type: ignore[arg-type]


@task("hunt.reconcile", resource="email", priority=CRITICAL, timeout_seconds=300)
async def reconcile(ctx: WorkerContext, t: BgTask) -> None:
    await engine.reconcile(ctx.maker, ctx.mailbox, ctx.settings, utcnow())  # type: ignore[arg-type]


@task("hunt.user_pass", resource="email", priority=NORMAL, timeout_seconds=600)
async def user_pass(ctx: WorkerContext, t: BgTask) -> None:
    """Draft one person's next notes and send one if it is due (their own Gmail, their limits)."""
    await engine.tick_user(ctx.maker, _user(t), ctx.mailbox, ctx.settings, ctx.llm, utcnow())  # type: ignore[arg-type]
