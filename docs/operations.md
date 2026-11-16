# Operations

How the Meet Practice Assistant is run once it is live: what we promise, what pages us, how data is
protected, and how a release goes out or back.

## Service levels

| Objective | Target | Measured by |
| --- | --- | --- |
| Answer outline starts streaming | median under 3 s, 95th percentile under 5 s | `answer_first_token_seconds` |
| Caption reaches the screen | under 1 s after the words end | provider-dependent; see "Not yet measured" |
| API availability | 99.5% of minutes healthy | `up`, `Http5xxRateHigh` |
| No lost words in a session | gaps are marked, never silent | `audio_websocket_closes_total`, session transcript gap markers |
| Spend stays inside budget | daily estimate under 80% of budget | `estimated_spend_usd_total` |

## Alerts and what to do

Rules live in `ops/alerts.yml`. A test (`api/tests/test_observability.py`) fails the build if a rule
uses a metric the API does not export or points at a runbook that does not exist. `page` means act
now, `ticket` means act within the working day.

| Alert | Severity | Runbook |
| --- | --- | --- |
| AnswerLatencyMedianHigh, AnswerLatencyP95High, AnswerModelFirstTokenSlow | page | [latency-spike](runbooks/latency-spike.md) |
| AnswerContextStageSlow, AudioSocketsNearLimit | ticket | [latency-spike](runbooks/latency-spike.md) |
| EventLoopLagHigh | page | [latency-spike](runbooks/latency-spike.md) |
| DbPoolSaturated | page | [db-connection-exhaustion](runbooks/db-connection-exhaustion.md) |
| ProviderErrorRateHigh, Http5xxRateHigh | page | [provider-outage](runbooks/provider-outage.md) |
| AnswersFallingBack | ticket | [provider-outage](runbooks/provider-outage.md) |
| ResearchFailuresHigh | ticket | [stuck-research-jobs](runbooks/stuck-research-jobs.md) |
| DailySpendNearBudget | page | [cost-spike](runbooks/cost-spike.md) |
| ApiTargetDown | page | this page, "API down" below |

Two thresholds are provisional and must be set from real numbers before the beta opens:
the daily budget in `DailySpendNearBudget` (50 USD is a placeholder) and the socket limit in
`AudioSocketsNearLimit` (see the load test below).

### API down

1. `GET /healthz` is the process; `GET /readyz` also checks the database. Which one fails?
2. Process down: look at the last deploy and the platform logs. A configuration refused at boot
   (`Unsafe configuration:` in the log) means an environment variable is wrong; fix it, redeploy.
3. Database down: check the database service in the platform first. The API retries on its own, and
   live sessions keep saving utterances for about 4 attempts before reporting a problem.
4. If a deploy caused it, roll back (below) first and investigate after.

## Where the signals are

- **Metrics**: `GET /metrics` (Prometheus text). In staging and production it needs the
  `METRICS_TOKEN` bearer token, and without one the endpoint does not exist (404). Labels use route templates, never ids; no transcript, note, company
  or email text is ever a label.
- **Logs**: one JSON line per request with a request id (also returned as `x-request-id`).
  Content is never logged: no transcript text, notes, URLs fetched for research, or tokens.
- **Errors**: optional Sentry (`SENTRY_DSN`), with request bodies, headers, cookies and query
  strings removed before sending.
- **Cost**: the admin-only usage page (`/admin/usage`, for emails in `ADMIN_EMAILS`) shows
  per-day estimated spend, caps hit and the heaviest users.

## Load test

`scripts/loadtest.sh` runs synthetic sessions against the real API (real WebSockets, database and
streaming) with **fake** transcription and answer providers. Results on a single worker, load
generator on the same machine, 24 to 40 s sessions:

| Concurrent sessions | Errors | Caption lag p95 | First answer token p95 | DB pool peak (of 20) | API memory |
| --- | --- | --- | --- | --- | --- |
| 40, all in lockstep | 0 | 0.18 s | 0.43 s | 20 (saturated, briefly) | 135 MB |
| 40, starts spread over 10 s | 0 | 0.01 s | 0.06 s | 2 | 131 MB |
| 120, spread over 20 s | 0 | 0.01 s | 0.07 s | 3 | 141 MB |
| 200, spread over 20 s | 0 | 0.01 s | 0.08 s | 3 | 151 MB |

What this tells us:

- The service itself is not the bottleneck at 200 simultaneous sessions on one worker.
- Worst case is every session asking for an answer in the same instant: the database pool (10 +
  10 overflow) fills and requests queue, adding a few hundred milliseconds. Nothing failed.
  `DbPoolSaturated` pages on sustained saturation. Raise `DB_POOL_SIZE` only if the database's
  connection limit allows it.
- The keepalive works: sessions longer than 30 s survive because the client answers server pings.
  A client that does not answer is dropped, which is intended.

**Not measured** (needs a real OpenAI key and a person on a real call): real transcription and
answer latency, the extra CPU of the real audio path (the limit in `AudioSocketsNearLimit` is set
at half the tested figure, 100 sockets per replica, to leave room for that), and behavior behind the
platform's proxy. Re-run with a real key before widening the beta.

## Backups and restore

The database is the only state. Audio is never stored.

- Enable the platform's automated database backups and point-in-time recovery, and keep at least
  7 days. Confirm the setting in the platform dashboard; this repository cannot do it.
- **Drill**: `scripts/restore_drill.sh` dumps the database, restores it into a scratch database,
  and checks that every table has the same row count and the migration version matches. It exits
  non-zero on any difference (checked by deliberately emptying a table in a restored copy).
  Run it before launch, after any schema change, and once a quarter. The drill was run against the
  development database (about 1,500 utterances across 780 users): all 15 tables matched.
- To restore for real: create a new database from the platform's backup or point-in-time, point
  `DATABASE_URL` at it, redeploy, and confirm `GET /readyz`. Sessions are re-created by signing in
  again; nothing else is needed.

## Retention

Open decision. Today transcripts and outlines are kept until the user deletes the session, and
deleting an account removes everything. A time-based retention policy (for example delete sessions
older than N days) needs a product decision and is not implemented.

## Secrets and key rotation

| Secret | Rotate by | Effect |
| --- | --- | --- |
| `OPENAI_API_KEY` | create a new key, set it, redeploy, delete the old one | none visible |
| `COOKIE_SECRET` | set a new value (32+ random chars), redeploy | everyone is signed out; unused audio tokens stop working |
| `METRICS_TOKEN` | set a new value, update the scraper | scraping fails until updated |
| `DATABASE_URL` password | rotate in the database service, update the variable, redeploy | brief reconnect |
| `SENTRY_DSN` | replace in Sentry, update the variable | none |

Rotate immediately if a secret appears in a log, a ticket or a chat. The API refuses to start in
staging or production with the default cookie secret, a non-https `WEB_ORIGIN`, the default database
password, fake providers on, or (production) no OpenAI key.

## On call

- Page alerts go to whoever is on call; ticket alerts go to the backlog. Set the routing in the
  alert manager; it is not defined in this repository.
- Start from the runbook linked in the alert. If a runbook is wrong or missing a step, fixing it is
  part of closing the incident.
- Safe levers that need no deploy: lower the per-user caps (`CAP_*`), pause research by setting
  `CAP_RESEARCH_JOBS_DAILY=0`, switch `OPENAI_REALTIME_PROTOCOL` between `beta` and `ga`.

## Release and rollback

1. CI must be green on the commit (lint, types, tests, migration up/down/up, OpenAPI drift, audits).
2. Deploy to staging, check `/readyz`, sign in, run one live session.
3. Deploy to production. Migrations run first as the pre-deploy step. Rule for every migration: it must work with the
   previous release's code (add columns and tables; remove or rename only in a later release), so
   a rollback never needs a schema rollback. CI proves up/down/up works, not this compatibility,
   so reviewers must check it.
4. Watch `Http5xxRateHigh`, `AnswerLatencyMedianHigh` and `ProviderErrorRateHigh` for 30 minutes.
5. **Rollback**: redeploy the previous image. On shutdown the API closes audio sockets with code
   1012 so browsers reconnect to the new instance on their own, and running jobs are recovered on
   the next boot. Never roll back a migration under load; add a corrective migration instead.
