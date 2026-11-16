# Runbook: research jobs stuck or failing

**Alert:** `ResearchFailuresHigh` (over 20% of jobs failed in an hour). Also reported by users: a brief
that never leaves "Reading pages" or "Searching".

## How jobs normally end
A job runs in the API process through `queued → reading_pages → searching → writing → ready | failed`,
heartbeating as it goes, with a 90 s work budget and a 3 minute ceiling. On boot, any job whose heartbeat
is older than 2 minutes is requeued once, then failed with "Research was interrupted…".

## Find stuck jobs
```sql
select id, company_id, status, step_detail, attempts,
       now() - coalesce(heartbeat_at, started_at) as quiet_for
from research_jobs
where status in ('queued','reading_pages','searching','writing')
order by started_at;
```
A job quiet for more than 2 minutes while the API is up is stuck (its task died). Failing it lets the
user retry:
```sql
update research_jobs
set status = 'failed', error = 'Research was interrupted. Press Research to run it again.',
    finished_at = now()
where status in ('queued','reading_pages','searching','writing')
  and now() - coalesce(heartbeat_at, started_at) > interval '5 minutes';
```
(Restarting an API replica does the same through boot-time recovery.)

## Failing rather than stuck
- `error` text says the key is not configured: set `OPENAI_API_KEY`.
- "No readable sources": the user's links are blocked or need a sign-in. This is expected for some sites;
  the user pastes text. A sudden jump across many companies suggests the fetcher is being blocked:
  check the `User-Agent` (`FETCH_USER_AGENT`) and robots.txt handling.
- Many failures with provider errors: see `provider-outage.md`.
- `429 daily_cap` on creating companies: raise `CAP_RESEARCH_JOBS_DAILY` only if it is genuine use.

## Check the safety rails, not just the symptom
Fetcher limits (10 s, 2 MB, 3 redirects, public addresses only) must stay as designed. Never relax them
to make a site work.
