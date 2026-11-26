"""The unified background worker: one process, one deployment, every background task.

    python -m app.workers.main

It runs the scheduler (what is due, from bg_schedules) and the dispatcher (claims tasks from the
durable queue and runs them within the configured limits) side by side. Set BACKGROUND_MODE=worker
on both the API and this service, so the API stops running background work itself."""

import asyncio
import contextlib
import logging
import signal

from app import metrics
from app.autoapply.clock import utcnow
from app.config import Settings, get_settings
from app.db import dispose_engine, get_sessionmaker
from app.logging_config import configure_logging
from app.workers import queue
from app.workers.context import WorkerContext
from app.workers.dispatcher import Dispatcher
from app.workers.infra.resources import AiGate

log = logging.getLogger("app.workers")


def build_context(settings: Settings) -> WorkerContext:
    from app.autoapply import discovery, forms, mailboxes
    from app.services.providers import build_answer_llm
    from app.workers.infra.browser import BrowserManager

    browser = BrowserManager(executable_path=settings.autoapply_browser_path or None)
    ctx = WorkerContext(
        maker=get_sessionmaker(),
        settings=settings,
        sources=discovery.build_sources(settings),
        form=forms.build(settings, manager=browser),
        mailbox=mailboxes.build(settings),
        llm=AiGate(build_answer_llm(settings), settings.worker_max_ai_requests),
    )
    ctx.extra["browser"] = browser
    return ctx


async def scheduler_loop(ctx: WorkerContext, stop: asyncio.Event) -> None:
    from app.workers import schedule

    while not stop.is_set():
        wait = 5.0
        try:
            now = utcnow()
            for name in await schedule.due(ctx, now):
                added = await schedule.fire(ctx, name, now)
                log.info("schedule fired", extra={"fields": {"schedule": name, "added": added}})
            async with ctx.maker() as db:
                st = await queue.stats(db, utcnow())
            metrics.worker_queue_oldest.set(st["oldest_due_seconds"])
            metrics.worker_queue_backlog.set(st["by_status"].get("queued", 0))
            wait = await schedule.next_due_in(ctx, utcnow())
        except Exception:  # noqa: BLE001 - a bad pass must not end the scheduler
            log.exception("scheduler pass failed")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=wait)


async def run(settings: Settings | None = None) -> None:
    import app.workers.handlers  # noqa: F401 - registers every task kind

    settings = settings or get_settings()
    configure_logging(settings.log_level)
    if settings.background_mode != "worker":
        raise SystemExit(
            "BACKGROUND_MODE must be 'worker' here (and on the API), or both would run the same "
            "background work."
        )
    ctx = build_context(settings)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)
    dispatcher = Dispatcher(ctx)
    log.info("worker started", extra={"fields": {"worker": dispatcher.name}})
    try:
        await asyncio.gather(dispatcher.run(stop), scheduler_loop(ctx, stop))
    finally:
        browser = ctx.extra.get("browser")
        if browser is not None:
            await browser.close()
        await dispose_engine()
        log.info("worker stopped")


if __name__ == "__main__":
    asyncio.run(run())
