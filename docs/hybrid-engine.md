# Hybrid application engine

How Auto-Apply carries out applications on employers' own forms: on the candidate's computer, where
they can watch, or on the server, through the one background worker. Both run the same rules, share
one live record of the run, and can never both send the same application.

**No real job application was submitted while building or testing this.** Every test applies to
pages served from the test machine itself. A first real submission needs the person's explicit go-ahead
(see "What is verified, and what is not").

## The parts

| Part | Where | What it does |
|---|---|---|
| ATS registry | `backend/app/autoapply/ats.py`, `desktop/src/auto/rules.js` | Which applicant-tracking system a page is (Greenhouse, Ashby, Lever, SmartRecruiters, Workable, Recruitee, Workday, BambooHR, generic), what its submit/next buttons and confirmation look like, how far it has been checked. One table; the JavaScript copy is tested against the Python one on shared cases (`desktop/test/parity.test.js`). |
| Form engine (server) | `backend/app/autoapply/browserform.py` | Reads the form with `scan_form.js`, fills it screen by screen, checks required fields (`validate_form.js`), presses submit, waits for the employer's own confirmation. Runs in the unified worker's shared Chromium (one browser, a fresh isolated context per job, concurrency 1). |
| Form engine (desktop) | `desktop/src/auto/engine.js`, `driver.js` | The same steps in the visible workspace, driven through the browser's debugging protocol in an isolated JavaScript world. Uses the very same `scan_form.js` and `validate_form.js` (a test fails if the copies differ). |
| Ownership and leases | `backend/app/autoapply/outbox.py`, `desktop.py` | One claim per application under a lock; each attempt has a unique idempotency key and a lease that every sign of life renews. |
| Run record | `backend/app/autoapply/runlog.py`, `routers/autoapply_run.py` | `aa_run_state` (what is happening now, pending skip/stop, speed, where forms run), `aa_run_events` (ordered, persisted, no typed answers), `aa_executors` (which computers are open). |
| Method ladder | `backend/app/autoapply/routing.py` | Which way an application goes (below). |
| Run panel | web/mobile `/auto-apply/run`, desktop workspace panel | Live progress and the controls, from the same state. |

## Execution ownership

An application is carried out by exactly one executor, decided by the server, never by the client.

1. `claim_next` takes the candidate's campaign lock, then `FOR UPDATE SKIP LOCKED` on the next queued
   application. It writes a `submission_attempts` row with a unique idempotency key
   (`<application>:<channel>:<n>`) and the executor (`cloud` or `desktop`, plus the desktop's id).
2. Where a browser form runs: `execution_mode` (`auto`, `desktop`, `cloud`). In `auto` it is the
   desktop when that computer checked in within the last 90 seconds, otherwise the server. An
   application claimed for one executor is invisible to the other.
3. Every checkpoint renews the attempt's lease (3 minutes). The desktop's `events` call does it for
   the desktop; the worker's progress callback does it for the cloud.
4. Immediately before the submit button the executor asks the server (`dispatch`). The server
   re-runs every check (consent, campaign, quotas, the listing still open, the operator's kill
   switches, the candidate's skip/stop) and only then moves the attempt to `dispatched`.
5. A lease that runs out before `dispatched` releases the application back to the queue. A lease
   that runs out after `dispatched` marks it **ambiguous** and asks the candidate; it is never sent
   again automatically.
6. The result call is accepted only from the executor that owns a live attempt; a stale desktop gets
   `409 not_yours` and stops.

Verified by `backend/tests/autoapply/test_run.py` and `test_outbound.py`: two executors never both
get one application, a dead desktop's attempt is recovered, a dead worker after dispatch becomes
ambiguous, the same intent never sends twice, a stale desktop is refused.

## Method ladder

`routing.choose` returns the first method that the job offers and the candidate has on:

1. authorized API — **not built** (no employer has granted this app API access)
2. HTTP form — **not built**
3. email — built; used whenever the posting has an explicit application address
4. browser — built; deterministic fill, on the desktop or the server
5. AI-assisted — **not built** as a driver. A model only suggests answers while the package is
   prepared; it never fills or submits a form
6. candidate — always possible: the job and the exact CV are ready, the candidate presses the button

A system that needs an account (Workday) goes straight to the candidate with the CV ready. Nothing is
worked round. Email now outranks the browser (it is cheaper and needs no site cooperation).

## Verified success only

A browser application counts as sent only with the employer's confirmation: its own words on the
page ("Thank you for applying", "application received"…) or a new address that says so
(`/confirmation`, `/thanks`…). The desktop sends the page text and address; **the server checks the
proof again** (`ats.confirmation`) and refuses success without it. Pressing the button is never
proof. Anything unclear after the press is `ambiguous`; the candidate is asked, and the application
is not sent again. Each success stores a receipt: system, number of steps, and the name, size and
SHA-256 of every document uploaded (the exact CV, `cv_version`).

## Intervention, never a workaround

CAPTCHA, a sign-in wall, a closed job, a question that has no stored answer, a required declaration
(work authorisation, clearance, sponsorship…): the application stops. On the desktop the person is
looking at the form, so the panel asks them to deal with it and continue, or skip. On the server, a CAPTCHA no longer sends the job to the "apply yourself" list: it goes back in the
queue marked for the desktop (`match.needs_desktop`), the server skips it, and the desktop app picks it
up, fills the form and waits for the person to pass the check. A system that nearly always has one
(Lever) goes straight to the desktop when it is open. If the desktop is not opened within 24 hours, or
the person chose "our servers only", it is handed to them as before. A CAPTCHA is never solved or
worked round by the app. Other stops (sign-in wall, closed job) go to the candidate. An unanswered required question is found **before anything is typed**.
Answers come only from the candidate's saved facts and the frozen package; nothing is invented.

## How answers are chosen

Layers, in order; the first that has a real answer wins, and a required question that none can answer
stops the application before anything is typed (`package.resolve_answers`, and again on the page by
`unanswered`):

1. an answer the candidate gave for this application;
2. a saved answer the candidate approved for reuse (`CandidateAnswer.reusable`), so the same
   question is not asked twice;
3. the candidate's verified CV facts (name, email, phone, location, links, current company);
4. otherwise the question goes to the candidate: **never guessed, never defaulted**. A declaration
   (work authorisation, sponsorship, clearance, demographic and similar) is only ever the candidate's
   own, given for that application.

A model writes the cover letter and tailors the CV while the package is prepared; the candidate can
read the frozen package before it goes, and what was sent is stored exactly. Multiple choices are
matched to the form's own options by the same words (`pick`, identical in Python and JavaScript); no
match is a stop, not a nearest guess. Each field event records which field was filled, not the typed text (the
package records where each answer came from). A model is never asked to answer a question while a form is open,
and nothing a page says is ever treated as an instruction.

## Real-time record

Every step writes one `aa_run_events` row (`application_started`, `form_discovered`,
`field_completed`, `document_uploaded`, `step_completed`, `application_validated`,
`submission_started`, `submission_verified`, `application_failed`, `application_skipped`,
`review_required`, run controls…). The event holds the question and the fact found, never an answer
typed. Screens read `GET /api/autoapply/run` and follow `GET /api/autoapply/run/events?after=N&wait=25`
(long poll over plain HTTP: it works on the web, in the desktop app and on a phone, behind any proxy).
Start, pause, resume, skip, stop and speed write to `aa_run_state`; both executors read them at every
checkpoint, and **skip/stop cannot take effect after the submit button was pressed** (the page may
already have the application).

## Desktop workspace and security

`desktop/src/workspace.js`. One window: the employer's page on the left, the control panel on the right.

* The employer page is a separate `WebContentsView` with a fresh in-memory session per application
  (storage and cache cleared when it ends), no preload script, sandbox, context isolation, no node,
  every permission denied, pop-ups and `<webview>` denied.
* It can reach only public `https` addresses. Every request (including redirects, sockets and
  sub-resources) is checked by name **and by what the name resolves to**, so a name that points at a
  private address is refused (`guard.js`, covered by `guard.test.js`). Credentials in an address, odd
  ports, `localhost`, `.local`, `.internal` and IP literals are refused.
* The sign-in token is held only in the main process's memory. Only the app's own page may hand it
  over; the employer page and the panel never see it. The panel gets five narrow calls
  (snapshot, control, speed, answer) and renders everything as text.
* Reading and typing run in an isolated JavaScript world the page cannot see or alter; typing and
  clicks are real input events. Documents are written to a private temporary folder (mode 0600) for the
  upload and deleted when the application ends.
* An employer page cannot instruct the automation: answers come from the server's package, and page
  text is only ever matched against fixed patterns (closed/blocked/confirmation), never interpreted.

`desktop/test/workspace.js` starts the real app and checks, against pages served from the test
machine: a form is filled with the exact CV and confirmed; a hostile page sees no app bridge, no
`require`/`process`, no panel, and cannot reach the local network or open windows.

## Cost and resources

The back office (Admin → Auto-Apply) shows, per executor and channel for the last 7 days: attempts,
confirmed, unknown, failed, average time and total time. Run events and computers that have not
checked in for 30 days are purged hourly by the worker (`runlog.purge`).

* **No new deployment and no paid browser service.** Cloud applications run in the one unified
  worker (`python -m app.workers.main`): Chromium starts lazily on the first browser job, one at a
  time, a fresh isolated context per application, recycled by the existing BrowserManager.
* When the candidate's computer is open (`auto`), browser applications run there and cost the
  platform nothing. Email applications use the candidate's own mailbox.
* Speed (slow 3 min, normal 75 s, fast 30 s between browser applications) applies to real forms and
  to the desktop; fixtures are unaffected.

## What is verified, and what is not

| System | Status | Meaning |
|---|---|---|
| Greenhouse | **live read**, fixture fill | The real application page structure was read in a browser (nothing submitted); filling, uploading, validation and confirmation are tested on a copy of it. |
| Ashby | fixture | Tested on a copy built from public page markup; never seen on a live site. |
| Lever | fixture | The same. Most Lever postings carry hCaptcha, so most will be handed to the candidate. |
| SmartRecruiters, Workable, Recruitee, BambooHR | **untested** | Detection and selectors only; **off** unless `AUTOAPPLY_ATS_ENABLED` lists them or says `all`. |
| Workday | detected only | Needs an account; goes to the candidate. |
| Any other company page | untested | Only with `AUTOAPPLY_FORM_HOSTS=*`; the form is read first and handed back when it cannot be answered honestly. |

`AUTOAPPLY_ATS_ENABLED`: empty (Greenhouse, Ashby, Lever), a comma-separated list, or `all`.
Real submissions still need `AUTOAPPLY_FORM_ADAPTER=browser`, `AUTOAPPLY_FORM_DISPATCH=true` and the
production environment, exactly as before.

**Not done, and why**

* A first real submission on each live system: needs the candidate's explicit go-ahead; none was made.
* Direct employer APIs, HTTP-level form posting and a model-driven page driver: not built (see ladder).
* CAPTCHA/OTP: deliberately never solved; always handed to a person.
* The workspace runs on Windows, macOS and Linux Electron; it was exercised end to end on Linux here.
  Windows runs the same smoke test in CI (`npm run smoke:workspace`); a Mac build is not signed.
* Phones show the live panel and controls but do not run forms (no browser to drive there).
