# Unified worker: benchmarks and capacity (2026-11-26)

`backend/scripts/bench_worker.py` fills a scratch database with candidates (confirmed facts, active
campaign, daily cap 10) and jobs already stored centrally, fires the Auto-Apply schedule and lets
one dispatcher run everything through the fixture form filler and mailbox. The model is an instant
stand-in, so these are the worker's own costs; model latency and price come on top.

Machine: the development sandbox (4 vCPU, 16 GB), Postgres 16 on the same machine. One worker,
`WORKER_MAX_CONCURRENT_TASKS=5`.

## Measured

| Run | Candidates × stored jobs | Wall time | Per candidate pass | Prepared | Kept as matches | Peak memory | DB connections |
|---|---|---|---|---|---|---|---|
| before the preparation cap | 100 × 800 | 130.5 s | 6.4 s | 40,000 | 0 | 178 MB | 7 |
| with the cap (`AUTOAPPLY_PREPARE_AHEAD=2`) | 100 × 400 | 65.3 s | 3.1 s | 2,000 | 18,000 | 120 MB | 7 |

- About 15 ms per candidate × job judgement (rules, then the application record).
- A first pass for a new candidate judges every stored job from the last 30 days that could fit
  their role; later daily passes judge only jobs added since, so they are much shorter.
- The cap was the important finding: without it every match was prepared at once (CV tailored,
  cover note written: two model calls each), about 400 per candidate on day one against a daily
  cap of 10. With it, two days' worth is prepared and the best waiting matches are prepared as
  room frees up: **90% fewer preparation model calls** in this run.
- Browser sessions on local test pages: the 15 browser form tests take about 4 s each (open,
  read or fill, close). Real employer pages will be slower; measure on the first supervised runs.

## Capacity (worked out, not measured at that size)

Assumptions, to be replaced with production measurements: 50 new relevant jobs per candidate
per day; 15 ms per judgement; 10 applications per candidate per day; 20% of applications go
through the browser at 30 s each; the rest by email at 1 s.

| Active candidates | Judging (worker-seconds/day) | Browser (session-hours/day) | One worker, 1 browser slot? |
|---|---|---|---|
| 100 | 75 | 1.7 | yes |
| 1,000 | 750 | 17 | judging yes; browser needs ~1 slot all day |
| 10,000 | 7,500 | 167 | needs about 8 browser slots: more memory, or a second replica |
| 50,000 | 37,500 | 833 | several replicas; browser is the bottleneck |
| 100,000 | 75,000 | 1,667 | browser work dominates; this is when a separate browser pool is justified |

Browser session-hours per day = candidates × 10 × 20% × 30 s ÷ 3600. One browser slot gives at
most 24 session-hours a day; plan for about 70% use. So the browser, not matching, decides when to
add capacity: raise `WORKER_MAX_BROWSER_SESSIONS` while memory allows, then add replicas of the
same worker, and only then consider a dedicated browser pool (docs/worker.md, "When to scale").

## Cost (configured prices, not verified against the provider today)

Model prices come from settings (`PRICE_LLM_INPUT_PER_MILLION=0.40`,
`PRICE_LLM_OUTPUT_PER_MILLION=1.60`, the values in the code; confirm on the provider's pricing
page). A prepared application makes two model calls (tailored CV, cover note), roughly 3,000
input and 600 output tokens together: about $0.0022 per prepared application at those prices,
$0.022 a day for a candidate sending 10. Matching itself makes no model call. Real spend is
recorded per person in the usage table (`/admin/usage`); worker time per task kind is in the back
office (Background work).
