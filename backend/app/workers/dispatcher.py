"""Claims tasks from the durable queue and runs them, as many at once as the limits allow.

- One claim at a time, for whichever resource still has a free slot, most urgent task first: the
  worker never takes more than it can start, and a slow browser task never holds a slot that a
  reply from an employer is waiting for.
- A running task's lease is renewed every third of the lease; if renewal fails (cancelled, or the
  lease was lost) the task is stopped.
- Every task has a deadline. A kind that keeps failing is paused for a while (circuit breaker).
- Heavy work (browser, documents, AI) waits while memory or CPU is short; light work carries on.
- On shutdown nothing new is claimed; running tasks get a grace period, and whatever is still
  running is handed back to the queue for the next worker."""

import asyncio
import logging
import os
import socket
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

from app import metrics
from app.autoapply.clock import utcnow
from app.models import BgTask
from app.workers import queue, registry
from app.workers.context import WorkerContext
from app.workers.infra.resources import Limits, heavy_allowed, measure

log = logging.getLogger("app.workers.dispatcher")

BREAKER_FAILURES = 5
BREAKER_PAUSE = timedelta(minutes=5)
RECOVER_EVERY = 30.0  # seconds between sweeps for abandoned tasks


def worker_name() -> str:
    return f"{socket.gethostname()[:40]}:{os.getpid()}:{uuid.uuid4().hex[:6]}"


class Dispatcher:
    def __init__(
        self,
        ctx: WorkerContext,
        *,
        name: str | None = None,
        now: Callable[[], datetime] = utcnow,
    ) -> None:
        self.ctx = ctx
        self.s = ctx.settings
        self.name = name or worker_name()
        self.now = now
        self.limits = Limits(self.s)
        self.lease = timedelta(seconds=max(10, self.s.worker_lease_seconds))
        self.running: dict[uuid.UUID, tuple[BgTask, asyncio.Task[None]]] = {}
        self._failures: dict[str, int] = {}
        self._paused_until: dict[str, datetime] = {}
        self._freed = asyncio.Event()
        self._lost: set[uuid.UUID] = set()
        self._stopping = False

    # ------------------------------------------------------------------ claiming

    def _skipped_kinds(self) -> tuple[str, ...]:
        now = self.now()
        return tuple(k for k, until in self._paused_until.items() if until > now)

    async def fill(self) -> int:
        """Claim and start as many tasks as there are free slots. Returns how many started."""
        if self._stopping:
            return 0
        heavy_ok = heavy_allowed(self.s, measure())
        metrics.worker_heavy_paused.set(0 if heavy_ok else 1)
        started = 0
        while True:
            open_ = self.limits.open_resources(heavy_ok)
            if not open_:
                break
            got = await queue.claim(
                self.ctx.maker,
                worker=self.name,
                now=self.now(),
                limit=1,
                resources=open_,
                lease=self.lease,
                aging_seconds=self.s.worker_aging_seconds,
                skip_kinds=self._skipped_kinds(),
            )
            if not got:
                break
            for t in got:
                self._start(t)
                started += 1
        return started

    def _start(self, t: BgTask) -> None:
        self.limits.take(t.resource)
        metrics.worker_running.labels(t.resource).set(self.limits.busy[t.resource])
        job = asyncio.create_task(self._run(t), name=f"task:{t.kind}:{t.id}")
        self.running[t.id] = (t, job)

    # ------------------------------------------------------------------ running one

    async def _beat(self, t: BgTask, work: "asyncio.Task[object]") -> None:
        every = max(1.0, self.lease.total_seconds() / 3)
        while True:
            await asyncio.sleep(every)
            ok = await queue.heartbeat(self.ctx.maker, t.id, self.name, self.now(), self.lease)
            if not ok:  # cancelled by someone, or the lease was lost: stop working on it
                self._lost.add(t.id)
                work.cancel()
                return

    async def _run(self, t: BgTask) -> None:
        spec = registry.spec(t.kind)
        began = time.perf_counter()
        outcome = "done"
        try:
            if spec is None:
                outcome = "dead"
                await queue.fail(
                    self.ctx.maker, t, self.name, self.now(),
                    error_class="unknown_kind", message=f"No handler for {t.kind!r}.", retry=False,
                )  # fmt: skip
                return
            work: asyncio.Task[object] = asyncio.create_task(spec.handler(self.ctx, t))
            beat = asyncio.create_task(self._beat(t, work))
            try:
                await asyncio.wait_for(asyncio.shield(work), timeout=t.timeout_seconds)
            except TimeoutError:
                work.cancel()
                outcome = await queue.fail(
                    self.ctx.maker, t, self.name, self.now(), error_class="timeout",
                    message=f"Ran longer than {t.timeout_seconds} s.", retry=True,
                )  # fmt: skip
                self._trip(t.kind)
                return
            except asyncio.CancelledError:
                work.cancel()
                if t.id in self._lost:
                    outcome = "lost"
                    return  # someone else owns it now; leave its row alone
                raise  # shutdown: the caller releases it
            except registry.Permanent as exc:
                outcome = await queue.fail(
                    self.ctx.maker, t, self.name, self.now(),
                    error_class="permanent", message=str(exc), retry=False,
                )  # fmt: skip
                return
            except Exception as exc:  # noqa: BLE001 - recorded on the task, retried with a wait
                log.exception("task failed", extra={"fields": {"kind": t.kind, "task": str(t.id)}})
                outcome = await queue.fail(
                    self.ctx.maker, t, self.name, self.now(),
                    error_class=type(exc).__name__, message=str(exc) or type(exc).__name__,
                    retry=True,
                )  # fmt: skip
                self._trip(t.kind)
                return
            finally:
                beat.cancel()
            if t.id in self._lost:
                outcome = "lost"
                return
            await queue.complete(self.ctx.maker, t, self.name, self.now())
            self._failures.pop(t.kind, None)
        finally:
            metrics.worker_tasks.labels(t.kind, outcome).inc()
            metrics.worker_task_seconds.labels(t.kind).observe(time.perf_counter() - began)
            self.limits.give(t.resource)
            metrics.worker_running.labels(t.resource).set(self.limits.busy[t.resource])
            self.running.pop(t.id, None)
            self._lost.discard(t.id)
            self._freed.set()

    def _trip(self, kind: str) -> None:
        n = self._failures.get(kind, 0) + 1
        self._failures[kind] = n
        if n >= BREAKER_FAILURES:
            self._paused_until[kind] = self.now() + BREAKER_PAUSE
            self._failures[kind] = 0
            log.warning("pausing a failing task kind", extra={"fields": {"kind": kind}})

    # ------------------------------------------------------------------ the loop

    async def run(self, stop: asyncio.Event) -> None:
        idle = 0
        last_recover = 0.0
        while not stop.is_set():
            try:
                if time.monotonic() - last_recover >= RECOVER_EVERY:
                    last_recover = time.monotonic()
                    await queue.recover_expired(self.ctx.maker, self.now())
                started = await self.fill()
            except Exception:  # noqa: BLE001 - the database blinked: wait and try again
                log.exception("dispatcher pass failed")
                started = 0
            idle = 0 if started or self.running else idle + 1
            wait = min(15.0, self.s.worker_poll_seconds * (2 ** min(idle, 3)))
            self._freed.clear()
            try:  # wake early when a slot frees up or we are told to stop
                stopper = asyncio.create_task(stop.wait())
                freed = asyncio.create_task(self._freed.wait())
                await asyncio.wait(
                    {stopper, freed}, timeout=wait, return_when=asyncio.FIRST_COMPLETED
                )
            finally:
                stopper.cancel()
                freed.cancel()
        await self.shutdown()

    async def shutdown(self, grace: float = 25.0) -> None:
        """Stop claiming; give running tasks `grace` seconds, then hand the rest back."""
        self._stopping = True
        jobs = [job for _, job in self.running.values()]
        if jobs:
            _, pending = await asyncio.wait(jobs, timeout=grace)
            left = [tid for tid, (_, job) in list(self.running.items()) if job in pending]
            for job in pending:
                job.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            await queue.release(self.ctx.maker, left, self.name)
