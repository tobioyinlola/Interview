# Runbook: cost spike

**Alert:** `DailySpendNearBudget` (`increase(estimated_spend_usd_total[24h])` over 80% of the budget).
The estimate comes from audio seconds and tokens times the `PRICE_*` settings, so keep those current.

## Where the money goes
About 80% of a session's cost is live transcription (seconds of partner audio; a second source, the
microphone, doubles it). Then answers (≈ 40 calls a session), then research (a few dollars a month).

## Find the source
1. The owner's usage view (`/admin/usage`, for emails in `ADMIN_EMAILS`) shows daily totals and the
   heaviest users. Or query:
```sql
select u.email, g.day, g.stt_seconds, g.llm_input_tokens, g.llm_output_tokens, g.research_jobs
from usage g join users u on u.id = g.user_id
where g.day >= current_date - 2
order by g.stt_seconds desc limit 20;
```
2. In metrics: `stt_audio_seconds_total`, `llm_tokens_total{direction}`, and `audio_websockets_open` (a
   leak of idle sockets keeps transcribing silence).

## Contain
- Per-user caps already stop a single user: `CAP_STT_SECONDS_DAILY` (default 5,400 s), `CAP_TOKENS_DAILY`,
  `CAP_RESEARCH_JOBS_DAILY`. Lower them and redeploy to tighten everyone.
- A suspected script: the per-IP rate limits (`RATE_LIMIT_*`) and the per-email sign-in limit apply; check
  logs for one source. To stop an account for good, `delete from users where email = '…'` removes the user
  and everything it owns (cascade).
- Sockets left open: confirm `audio_websockets_open` falls when users leave; a missed pong closes a socket
  after about 30 s.

## Reduce structurally
Segment transcription mode (`gpt-4o-transcribe` on finished segments) is cheaper than live streaming but
slower to show text; the design records it as a later cost option. Prompt caching also lowers the
answer cost.

## Never
Do not remove the consent gate or caps. Do not paste the OpenAI key into tickets or chat. If abuse is
suspected, rotate the key (see `docs/operations.md`).
