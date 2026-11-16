# Runbook: database connection exhaustion

**Alert:** `DbPoolSaturated` (`db_pool_connections_in_use / db_pool_connections_max > 0.9` for 5 minutes).
Symptoms: requests hang, `5xx` rising, the context stage of answers slowing.

## Quick facts
- Each API replica has a pool of `DB_POOL_SIZE` (default 10) plus `DB_MAX_OVERFLOW` (default 10).
- Every statement is cut after `DB_STATEMENT_TIMEOUT_MS` (default 3000).
- The live path avoids the database where it can: the answer context is cached in memory per session, and
  utterance saves run beside captions with retries.

## Diagnose
```sql
-- who holds connections
select state, count(*), max(now() - state_change) as longest
from pg_stat_activity where datname = current_database() group by state;
-- long or stuck transactions
select pid, state, now() - xact_start as open_for, left(query, 80) as query
from pg_stat_activity
where xact_start is not null order by xact_start limit 10;
```
- Many `idle in transaction`: a code path holds a session open across a slow call. Find it from the
  query text and the recent deploy; fix or roll back.
- Many `active` long queries: look for a missing index or an unusually large read (review pages read a
  whole session). The 3 s timeout should already be cancelling them; check the logs for timeouts.
- Total connections near Postgres `max_connections`: replicas × (pool + overflow) is too large.

## Act
1. Roll back the last deploy if it correlates.
2. Add a connection pooler (PgBouncer, transaction mode) or lower `DB_POOL_SIZE` and add replicas.
3. As a stopgap, restart the saturated replica. Open audio sockets drop (code 1012 on a clean stop) and
   reconnect automatically.
4. Terminate stuck sessions only after looking at them:
   `select pg_terminate_backend(pid) from pg_stat_activity where state = 'idle in transaction' and now() - state_change > interval '5 minutes';`

## Afterwards
Record pool numbers at the time. If the cause was legitimate growth, plan the "Growth" step in the design
document (4–6 replicas, a connection pooler, a read replica for review pages).
