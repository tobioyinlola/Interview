# Implementation gap analysis (2026-11-26)

Status key: **Done** (implemented and tested) · **Optimise** (works, should improve) · **Partial** ·
**Missing** · **Risk**. "Here" marks what changed in this round.

| Component | Existing implementation | Status | Issues | Required action | Priority | Cost impact |
|---|---|---|---|---|---|---|
| Web app | React + TypeScript (Vite), TanStack Query | Done | — | — | — | — |
| Phone app | Capacitor, carries its own interface copy, live updates | Done | old copies show old screens until updated | keep merging to `Staging` | Medium | — |
| Desktop app | Electron, sandboxed; auto-update | Optimise | hand-made 0.3.x/0.4.0 releases outrank automatic ones | number automatic builds above hand-made | High | — |
| API | FastAPI, one service, Postgres | Done | — | — | — | — |
| Background work | was an in-API loop | **Here: Done** | single worker is a single point of failure (no HA claimed) | create the worker service (needs approval) | High | +1 small service; API image can drop Chromium |
| Durable queue | none | **Here: Done** | Postgres-backed; fine to tens of tasks/s | watch backlog and oldest age | — | no Redis |
| Candidate knowledge base | `CandidateFacts` from the CV, verified by the person, CV hash | Partial | no per-claim evidence references; no notice period, portfolio links, excluded employers in one place | extend facts with evidence and these fields | High | none (deterministic) |
| CV parsing | pypdf/docx text, then one model pass, cached by CV hash | Optimise | parse runs in a thread that a timeout cannot stop | run in a child process | Low | low |
| Company registry | startups (outreach) and, **here**, `aa_job_sources` for job boards | **Here: Partial** | domain/industry not filled for settings boards | fill from research | Medium | — |
| ATS discovery | Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Workable, Personio, 8 public feeds | Done | Workday, BambooHR missing | add when a permitted feed is confirmed | Medium | — |
| Central discovery | was per candidate, per day, every source | **Here: Done** (opt-in, `AUTOAPPLY_DISCOVERY_MODE=central`) | conditional requests (ETag) not used; hashing instead | add ETag where boards send it | Low | requests fall from candidates×boards to boards |
| Normalisation and dedupe | canonical key (requisition id or employer URL), aliases, possible-duplicate flag | Done | no content-similarity dedupe | add trigram similarity if duplicates show | Low | — |
| Expiry | `expires_at`; **here** listings gone from their board are closed | Done | — | — | — | — |
| Matching stage 1 (eligibility) | deterministic rules: role, place, seniority, contract, salary, sponsorship, way to apply | Done | — | — | — | none |
| Matching stage 2 (semantic) | none (no embeddings) | Missing | — | only if stage-1+3 quality is not enough; pgvector then | Low | avoided |
| Matching stage 3 (AI fit) | one model check per shortlisted job | Partial | weighted 30/25/20/10/10/5 score and 85/70 thresholds not implemented | add weighted score with configurable weights | High | small model |
| CV tailoring | `tailor.py`: reorder, summary, no invented numbers | Done | no reuse of approved variants across similar jobs | cache variants by role family | Medium | saves model calls |
| Cover letters | `cover_note` when asked | Done | — | — | — | — |
| Method router | form (fixture/browser) or email per posting | Partial | no ATS submission API (none authorised); no lightweight HTTP form route | add only with written permission | — | — |
| Browser filling | Playwright, approved hosts, captcha/login/closed detection; **here** one shared browser | Done | Ashby/Workable not live-verified | supervised first real application | High | one browser |
| Screening answers | per-application answers from facts and the person | Partial | no answer bank reused across jobs | add an approved-answer bank by normalised question | High | fewer interruptions |
| Human intervention | needs_input, captcha/login stop, unknown outcomes ask the person | Done | — | — | — | — |
| Lifecycle and dedupe | statuses, `aa_submission_attempts` claimed before sending, reconcile | Done | form receipts only known in-process | store confirmation evidence | Medium | — |
| 30-day campaigns | enable, pause, resume, daily caps, time zones, backend-run | Done | no per-campaign budget | add a spend cap per campaign | Medium | bounds AI spend |
| Email | Gmail OAuth and app-password SMTP/IMAP, reading replies, classification rules | Partial | no Outlook OAuth; polling, no push | Outlook OAuth; Gmail push later | Medium | — |
| Interview Meet hand-off | invitation detected → interview record → prep | Done | — | — | — | — |
| AI cost control | usage table per person, daily STT cap, small models | Partial | no model routing tiers or campaign budgets | add budgets and routing | Medium | — |
| Cost accounting | `/admin/usage`, **here** worker time by task kind | Partial | no cost per verified application | derive from usage + attempts | Medium | — |
| Security | hashed tokens, CSRF, CSP, SSRF guard, route-guard test, outbound-link guard on notes | Done | rotate secrets pasted in chat | owner action | High | — |
| Payments | none (credits switched off) | Missing | — | choose a provider | — | — |
