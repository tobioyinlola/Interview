"""Clean-up the worker does on a schedule."""

from app.autoapply import scheduler as aa
from app.autoapply.clock import utcnow
from app.models import BgTask
from app.workers import queue
from app.workers.context import WorkerContext
from app.workers.queue import LOW
from app.workers.registry import task


@task("maintenance.housekeeping", priority=LOW, timeout_seconds=600, max_attempts=2)
async def housekeeping(ctx: WorkerContext, t: BgTask) -> None:
    """Expired sign-ins, the old event log, finished queue rows, and an idle browser's memory."""
    await aa.housekeeping(ctx.maker, ctx.settings)
    async with ctx.maker() as db:
        await queue.purge_finished(db, utcnow())
        await db.commit()
    browser = ctx.extra.get("browser")
    if browser is not None:
        await browser.close_if_idle()
