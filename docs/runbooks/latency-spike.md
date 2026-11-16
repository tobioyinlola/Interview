# Runbook: answer latency spike

**Alerts:** `AnswerLatencyMedianHigh`, `AnswerLatencyP95High`, `AnswerContextStageSlow`,
`AnswerModelFirstTokenSlow`, `EventLoopLagHigh`, `AudioSocketsNearLimit`.
**Promise at risk:** first words of an outline within 3 s (median) and 5 s (p95) of the question ending.

## 1. Find the slow stage (2 minutes)
Server-side the budget is: context load ≈ 0.3 s, backend and network to the model ≈ 0.3 s, model time
to first token ≈ 1.2 s. Transcription (≈ 0.5 s final text) and the browser's wait (≈ 0.5 s) are outside
these histograms.

| Look at | If high, the cause is |
|---|---|
| `answer_stage_seconds{stage="model_first_token"}` p95 | the model provider is slow |
| `answer_stage_seconds{stage="context"}` p95 | database (see `db_pool_connections_in_use`) or a huge brief/notes |
| `event_loop_lag_seconds` p99 | an overloaded replica (CPU, or something blocking the loop) |
| `audio_websockets_open` per replica | too many live sessions on one replica |
| `answers_total{outcome="fallback"}` rate | the primary model is failing and the breaker is diverting traffic |

## 2. Act
- **Model slow:** set `OPENAI_ANSWER_MODEL` to a faster model (and redeploy); check OpenAI's status page.
  The circuit breaker already diverts to `OPENAI_ANSWER_FALLBACK_MODEL` after 5 failures in 30 s for 60 s.
- **Replica overloaded or near the socket limit:** add API replicas (the API is stateless; only one
  WebSocket is sticky to a replica, and clients reconnect on their own).
- **Database:** see `db-connection-exhaustion.md`.
- **Huge prompts:** notes are capped at 16,000 characters and the brief at 6,000 when building a prompt;
  if you changed those, restore them.

## 3. Verify
`AnswerLatencyMedianHigh` clears after 10 minutes below 3 s. Spot-check one real session end to end.

## 4. Afterwards
Record the stage numbers and the cause. If sockets per replica were the limit, update the 100 in
`ops/alerts.yml` (`AudioSocketsNearLimit`) from the next load test.
