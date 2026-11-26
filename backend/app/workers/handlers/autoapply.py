"""Auto-Apply in the worker. Each handler is a thin call into the existing Auto-Apply code: the
worker decides when and how many at once; the business rules stay where they were."""

from app.autoapply import campaign, mailsync, outbox
from app.autoapply import scheduler as aa
from app.autoapply.clock import utcnow
from app.models import BgTask
from app.workers.context import WorkerContext
from app.workers.queue import CRITICAL, HIGH, LOW, NORMAL
from app.workers.registry import Permanent, task


def adapters(ctx: WorkerContext) -> outbox.Adapters:
    made = ctx.extra.get("adapters")
    if made is None:
        made = outbox.Adapters(form=ctx.form, mailbox=ctx.mailbox, settings=ctx.settings)  # type: ignore[arg-type]
        ctx.extra["adapters"] = made
    return made


def _user(t: BgTask):  # type: ignore[no-untyped-def]
    if t.user_id is None:
        raise Permanent("This task needs a person.")
    return t.user_id


@task("autoapply.campaigns", priority=CRITICAL, timeout_seconds=120)
async def close_campaigns(ctx: WorkerContext, t: BgTask) -> None:
    """End campaigns whose 30 days are up, and withdraw what they had not sent yet."""
    now = utcnow()
    async with ctx.maker() as db:
        closed = await campaign.close_expired(db, now)
    if closed:
        await outbox.expire_unsent(ctx.maker, now)


@task("autoapply.reconcile", resource="email", priority=CRITICAL, timeout_seconds=600)
async def reconcile(ctx: WorkerContext, t: BgTask) -> None:
    """Settle sends whose outcome is not known yet, before anything new is sent."""
    await outbox.reconcile(ctx.maker, adapters(ctx), utcnow())


@task("autoapply.prepare", resource="http", priority=NORMAL, timeout_seconds=900)
async def prepare(ctx: WorkerContext, t: BgTask) -> None:
    """Find jobs for one person, match them against their search, plan follow-up notes."""
    await aa.prepare_user(
        ctx.maker,
        _user(t),
        utcnow(),
        sources=ctx.sources,
        adapters=adapters(ctx),
        llm=ctx.llm,  # type: ignore[arg-type]
    )


@task("autoapply.send", resource="email", priority=HIGH, timeout_seconds=900)
async def send(ctx: WorkerContext, t: BgTask) -> None:
    """Send one person's approved applications and notes. Queued as a browser task when the form
    filler drives a real browser, so only as many run at once as there are browser slots."""
    await aa.send_user(ctx.maker, _user(t), utcnow(), adapters=adapters(ctx))


@task("mailbox.sync", resource="email", priority=HIGH, timeout_seconds=300)
async def read_mailbox(ctx: WorkerContext, t: BgTask) -> None:
    """Read one mailbox for replies from employers: acknowledgements, invitations, rejections."""
    await mailsync.sync_user(ctx.maker, ctx.mailbox, ctx.settings, _user(t), utcnow())  # type: ignore[arg-type]


@task("autoapply.observe", priority=LOW, timeout_seconds=60, max_attempts=1)
async def observe(ctx: WorkerContext, t: BgTask) -> None:
    await aa.observe(ctx.maker, utcnow())
