# Runbook: provider outage or high error rate

**Alerts:** `ProviderErrorRateHigh`, `AnswersFallingBack`, `Http5xxRateHigh`.
**Providers:** OpenAI for streaming transcription, answers and scoring, research and web search.

## What users see and what the system does by itself
| Failure | Automatic behaviour | User sees |
|---|---|---|
| Answer model errors or is slow | one retry on the fallback model; after 5 failures in 30 s the primary is bypassed for 60 s | outline still appears (slightly different model) |
| Answer model fails twice | outline error with a next step | "The answer couldn't be written. Ask again, or type the question." |
| Streaming transcription fails | one retry on the server; after two failures in a row the browser switches to sentence-by-sentence file transcription | notice: transcription is slower |
| Transcription fails entirely | `POST /segment` returns 502/503 | captions stop; typing a question still works |
| Search provider down | research continues with the pages read | brief says "web search was not done" |
| Model down during research | job fails with a plain message | "Research didn't finish…" and a retry button |
| Scoring fails | `scoring_status = failed` with an error | "Press Score to try again" |

## Steps
1. Confirm it is the provider, not us: `provider_calls_total{outcome="error"}` by `provider` and
   `operation`, and OpenAI's status page.
2. If only the primary answer model is failing: confirm `answers_total{outcome="fallback"}` is rising and
   answers still complete. No action needed; consider switching `OPENAI_ANSWER_MODEL` to the fallback.
3. If transcription is failing: tell active users to type questions; the segment fallback keeps working
   unless the whole transcription service is down. Do not restart replicas: sockets drop and reconnect
   into the same failure.
4. If errors are our own (5xx without provider errors): check the last deploy; roll back by redeploying
   the previous image (migrations are add-before-remove, so the old image works on the new schema).
5. Post a status note if it lasts more than 15 minutes.

## Do not
Do not disable the consent gate, caps or the grounding check to "get answers flowing".
