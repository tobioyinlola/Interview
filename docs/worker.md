# Background work: one unified worker

## What was there (audit, 2026-11-26)

Infrastructure on Railway (project "CF dev environment"): `backend` (FastAPI), `frontend` (the React
build behind nginx; not on Vercel), `Postgres`. No Redis, no queue service, no separate worker.

All background work ran **inside the API process**:

| Work | How it ran | Durable? |
|---|---|---|
| Auto-Apply pass (discovery, matching, sending), mailbox reading, startup outreach | one `asyncio` loop started at API boot (`autoapply/scheduler.py`), leader-locked across replicas | state in tables; the loop itself not |
| Company research (Interview Meet prep) | `ResearchRunner` tasks in the API, heartbeats in `research_jobs`, requeued on boot | yes (own table) |
| Answer scoring | `ScoringRunner` tasks in the API, failed on restart and redone | partly |
| Live audio relay (Interview Meet) | WebSockets in the API | must stay in the API |
| Browser form filling | a new Chromium per job, inside whichever process ran the pass | no |

Problems: browser work and long passes shared the API's process and memory; nothing outside the
loop could queue work; a pass for everyone ran in one go; a browser was started for every job.

## What it is now

```
API (FastAPI)                    unified worker (python -m app.workers.main)
 - answers requests               - scheduler: bg_schedules -> fans work out to the queue
 - Interview Meet relay           - dispatcher: claims from bg_tasks, runs within limits
 - research + scoring (for now)   - handlers: autoapply.*, mailbox.sync, hunt.*, maintenance.*
            \                       /
             one Postgres: tables + bg_tasks (queue) + bg_schedules
```

- **Queue** (`app/workers/queue.py`, table `bg_tasks`): kind, priority, status, resource class,
  person/campaign/application ids, run time, attempts and limit, timeout, idempotency key (one
  waiting or running task per key), payload, lease, error class, timings. Claimed with
  `FOR UPDATE SKIP LOCKED` in one short statement; no transaction stays open while work runs.
  Leases are renewed every third of the lease; an expired lease is recovered (requeued, or dead
  after its last attempt); failures retry with a growing wait (30 s, 2 min, 8 min ...); dead tasks
  are listed in the back office with "Try again". Survives restarts and crashes.
- **Priorities** (lower runs first, overridable with `WORKER_PRIORITIES=kind=n,...`): critical 0
  (reconciling uncertain sends, closing campaigns), high 10 (reading replies, sending), normal 20
  (finding and matching jobs, a person's outreach), low 30 (directories, research, observing,
  housekeeping). Waiting raises a task by up to two steps (one per `WORKER_AGING_SECONDS`), never
  past critical work. Long work is split per person, so no task holds the worker for long.
- **Limits** (`app/workers/infra/resources.py`): an overall cap and one per resource class (light,
  http, ai, email, document, browser). The dispatcher claims one task at a time for a class with a
  free slot, so it never takes more than it can start. Model calls are limited across all tasks
  (`AiGate`). Browser, document and AI work wait while memory (cgroup) or load is high; light work
  carries on.
- **Failure isolation**: per-task deadlines; a kind that fails 5 times in a row is paused for 5
  minutes; graceful shutdown stops claiming, waits 25 s and hands the rest back. Sends are claimed
  in `aa_submission_attempts` before they happen and reconciled before anything is sent again, so a
  crash mid-send never produces a second application.
- **Browser** (`app/workers/infra/browser.py`): one Chromium, started on first need, a fresh isolated
  context per task, recycled after 25 uses, closed when idle. Chromium runs in its own processes.
- **Scheduler** (`app/workers/schedule.py`, table `bg_schedules`): the next due time per recurring
  job; a due row is locked while it fires, so several workers never fire it twice. It sleeps until
  the next due time.

| Task kind | Resource | Priority | Reuses |
|---|---|---|---|
| `autoapply.campaigns` | light | critical | `campaign.close_expired`, `outbox.expire_unsent` |
| `autoapply.reconcile` | email | critical | `outbox.reconcile` |
| `autoapply.prepare` (per person) | http | normal | `scheduler.prepare_user` (discovery, matching, planned notes) |
| `autoapply.send` (per person) | browser or email | high | `scheduler.send_user` (`outbox.dispatch_user`, `outreach.send_next`) |
| `mailbox.sync` (per person) | email | high | `mailsync.sync_user` (replies, invitations) |
| `autoapply.observe` | light | low | `scheduler.observe` (metrics) |
| `hunt.directories`, `hunt.research` | http | low | `hunt.jobs` |
| `hunt.reconcile` | email | critical | `hunt.engine.reconcile` |
| `hunt.user_pass` (per person) | email | normal | `hunt.engine.tick_user` |
| `maintenance.housekeeping` | light | low | expired sign-ins, old events, finished tasks, idle browser |

## Central job discovery (`AUTOAPPLY_DISCOVERY_MODE=central`)

Before, each candidate's daily run read every configured board itself: candidates × boards
requests a day. In central mode the worker keeps a registry of boards (`aa_job_sources`: the
boards in the settings, plus every Greenhouse, Lever, Ashby, ... board a researched startup's
careers page points to) and reads each one once for everyone, through the existing readers
(`discovery.sync_source`, http, low priority). A board whose listing is unchanged (hashed) is not
rewritten and is read less often, up to daily; a busy one more often, down to hourly; one that
keeps failing is marked and backed off. A listing that leaves its board is closed. Each person's
run then matches the jobs stored since their last run, with no external request.

Needs `BACKGROUND_MODE=worker`; the server refuses to start with central discovery and no worker.
The back office shows the boards and the failing ones under Auto-Apply → Job boards.

## Turning it on (needs your approval: it adds one Railway service)

1. Railway: new service from this repo, root directory `backend`, same image. Start command:
   `python -m app.workers.main` (no port, no public domain). Variables: the backend's (database,
   OpenAI, mailbox key, Auto-Apply and outreach flags, SMTP, Google), plus `WITH_BROWSER=1`.
2. Set `BACKGROUND_MODE=worker` on **both** services. The API stops its own loop; the worker refuses
   to start without it, so the two never run the same work.
3. Check `/admin/auto-apply` → Background work: "Runs in the worker", tasks finishing.
4. Then the API can drop Chromium (`WITH_BROWSER=0`): a smaller, cheaper API image.

**Rollback**: set `BACKGROUND_MODE=api` on the API and stop the worker. Nothing queued is lost; it
waits in `bg_tasks` for the next start.

Starting values (benchmark before raising): `WORKER_MAX_CONCURRENT_TASKS=5`,
`WORKER_MAX_BROWSER_SESSIONS=1`, `WORKER_MAX_AI_REQUESTS=2`, `WORKER_MAX_DOCUMENT_TASKS=1`,
`WORKER_MAX_HTTP_TASKS=5`, `WORKER_MAX_EMAIL_TASKS=3`. One worker replica.

## When to scale

Watch `worker_queue_oldest_seconds`, `worker_queue_backlog`, `worker_tasks_running{resource}`,
`worker_heavy_paused`, and in the back office the worker time per kind (its share of the cost).

1. More CPU/memory for the one worker, then higher limits.
2. A second replica of the same worker: claims are `SKIP LOCKED`, schedules lock their row, keys
   stop duplicates. No code change.
3. Only if measurements show one kind (most likely the browser) starving the rest: a second worker
   that claims only that resource class. Write down the measurement and the cost first.

## Not moved yet

- Company research and answer scoring still run in the API: they are fast model calls tied to the
  interview screens and already durable. They can become worker tasks later.
- Notification emails are still sent where they happen.
- With the browser form filler on, each person's send pass is queued as browser work, so passes
  run one browser slot at a time even when a person has only email to send. Quick when there is
  nothing to send; if `autoapply.send` starts to wait, queue browser work only for people with a
  form application ready.
- Embeddings and pgvector: not used. Matching is deterministic rules plus one model check, which is
  cheaper; add vectors only if matching quality needs them.
- No payment provider yet; interview credits are switched off while testing.
