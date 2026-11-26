# Auto-Apply

A candidate uploads a CV, checks the facts read from it, sets what they want, and starts a 30-day
search. Every local day it finds new roles, applies to the ones that clearly fit (through an
employer form or from the candidate's own mailbox), tells the candidate when it needs them, reads
employer replies, and hands interviews to the existing interview-preparation flow.

Everything is **off by default** (`AUTOAPPLY_ENABLED=false`): the routes answer 404, no job runs and
the menu link is hidden.

## What a candidate sees

- **Set up** (`/auto-apply/setup`): confirm the details read from their CV; search rules (each can be
  a must or a preference); which ways to apply are allowed; reusable answers; a plain statement of
  what will be shared; an explicit agreement. Starting records the terms version and exactly what
  was shown.
- **Auto-Apply** (`/auto-apply`): the next interview first, then what needs them, then recent
  applications; today's use of their daily limit; pause, resume, search now, add a job by link.
- **An application**: why it matched (each rule with its evidence), the exact CV and note that was or
  will be sent, answers and where each came from, every attempt, the history, and the hiring-contact
  note.

## Rules the system keeps

- It applies without asking only when **every** criterion marked as a must is clearly met. A fail
  skips the role; an unknown (for example "remote" with no region stated, a salary in another
  currency or pay period, no word on sponsorship) goes to the candidate with the exact question.
- The CV is tailored only from facts the candidate confirmed. Titles, employers and dates are copied
  from those facts; reworded text that brings in a number, rank or qualification the CV never had is
  discarded and the candidate's own wording used.
- A declaration is only ever the candidate's own, given for that application. A saved answer is
  reused only when they ticked "reuse".
- One application per candidate and job, however many boards list it. One discovery run per
  candidate per local day, however many servers run.
- Before every send it checks again: paused, disconnected, search changed, outside active hours,
  campaign over, listing expired, a switch on, destination unchanged. Day 1 is the activation date
  in the candidate's timezone; sending closes at the start of day 31. Pausing does not extend it.
- An attempt is recorded as dispatched **before** the outside call. If the outcome is unknown it
  keeps counting against the daily limit and is settled by looking for evidence, never by sending
  again, and a form is never retried by email.
- Employer email is evidence, never instruction: it can change what is shown, but cannot cause a
  send, change a recipient or call anything. Message bodies are read in memory and not stored.

## Configuration

| Variable | Meaning |
| --- | --- |
| `AUTOAPPLY_ENABLED` | Master flag (default off) |
| `AUTOAPPLY_POLICY_VERSION` | Terms version recorded with each agreement |
| `AUTOAPPLY_DISCOVERY_SOURCES` | Comma list, any mix. No setup: `remotive`, `arbeitnow`, `remoteok`, `jobicy`, `himalayas`, `themuse`, `workingnomads`, `weworkremotely`. Need employer names (below): `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `recruitee`, `workable`, `personio`. `fixture` is for demo/tests. Only `jobicy` was written from its published docs; the rest were written from descriptions of each feed and have **not** been run against the live services |
| `AUTOAPPLY_GREENHOUSE_BOARDS` / `_LEVER_COMPANIES` / `_ASHBY_BOARDS` / `_SMARTRECRUITERS_COMPANIES` / `_RECRUITEE_COMPANIES` / `_WORKABLE_COMPANIES` / `_PERSONIO_COMPANIES` | Comma lists of the employers' board names for those sources |
| `AUTOAPPLY_SAMPLE_JOBS` | Demo mode: the fixture source offers twelve built-in sample jobs and the app says sending is simulated. Never in production |
| `AUTOAPPLY_MAILBOX_PROVIDER` | `fixture` (default) or `gmail` |
| `AUTOAPPLY_FORM_DISPATCH` / `_EMAIL_DISPATCH` / `_OUTREACH_DISPATCH` | Allow **real** sends on that channel. Fixtures never need them |
| `AUTOAPPLY_ALLOWED_RECIPIENTS` | Outside production, the only addresses a real mailbox may write to |
| `AUTOAPPLY_TICK_SECONDS` | How often the scheduler runs (0 = never) |
| `AUTOAPPLY_RECONCILE_HOURS` | Wait before asking the candidate about an unknown outcome (24) |
| `MAILBOX_ENCRYPTION_KEY` | Fernet key for stored mailbox tokens (required in production for Gmail) |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | Google OAuth client |

Generate the key with
`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
The API refuses to start in production with a half-configured Auto-Apply (see `hardening.py`).

## Integration choices and what is and is not verified

| Part | Choice | Status |
| --- | --- | --- |
| Mailbox | **Gmail** (OAuth, `gmail.send` + `gmail.readonly`) | Code complete and tested against recorded responses only. **Not run against live Google.** |
| Job discovery | Several at once: **Remotive, Arbeitnow, Remote OK** (public feeds, no setup), **Greenhouse, Lever, Ashby** (employer boards you name), plus a fixture source | Parsing tested against sample responses in each feed's published format. **Not run against the live services from this repository** (no outbound network). Big feeds are thinned to titles that could be a role the candidate wants. The same job found by two sources is one application. These sources only find jobs; a job that needs the employer's own site is kept as "Ready for you to apply" (see below) |
| Employer forms | **Fixture adapter only** | No real employer form adapter exists yet. The interface (`FormAdapter`) is ready; `AUTOAPPLY_FORM_DISPATCH` has nothing real to enable until one is approved |
| Everything else (limits, claims, reconciliation, matching, tailoring, replies, interviews, hand-off) | In-repo | Verified with the fixture adapters and the automated suite |

### Before any real send (provider setup, in order)

1. **Google Cloud**: create a project, enable the Gmail API, configure the OAuth consent screen with
   the `gmail.send` and `gmail.readonly` scopes (both sensitive: Google review is required before
   the app can serve the public). Create an OAuth client; add
   `{API_PUBLIC_URL}/api/autoapply/mailbox/callback` as the redirect URI.
2. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `MAILBOX_ENCRYPTION_KEY`,
   `AUTOAPPLY_MAILBOX_PROVIDER=gmail` in the backend service.
3. **Staging**: `AUTOAPPLY_EMAIL_DISPATCH=true` and `AUTOAPPLY_ALLOWED_RECIPIENTS=<your test inbox>`.
   Connect a test Gmail account, run a campaign against a fixture listing whose apply address is the
   allowlisted inbox, and check: the message and PDF arrive, the Sent folder shows it, a reply
   from the test inbox appears as a recruiting event, and Disconnect revokes access.
4. **Employer forms**: write a `FormAdapter` for one employer system that permits automated
   submission and test it against that employer's sandbox before enabling `AUTOAPPLY_FORM_DISPATCH`.
5. **Production**: opt-in only. Flip `AUTOAPPLY_ENABLED` with `AUTOAPPLY_EMAIL_DISPATCH=true`; keep the
   back-office switches ready (`global`, `provider:gmail`).

### Rollout and rollback

Fixture mode (default) → allowlisted test recipients → opt-in production. To roll back, turn on the
`global` switch (or flip `AUTOAPPLY_ENABLED` off to hide the feature): new sends stop at once,
history stays, and in-flight attempts keep being settled.

## Data and deletion

Stored: search profile and authorisation, confirmed CV facts, approved answers, postings, each
application with its frozen package, attempts, hiring-contact notes, recruiting events (sender,
subject, kind, times, links: no bodies) and interview records. Mailbox tokens are encrypted;
disconnecting deletes them and asks Google to revoke. Deleting the account deletes all of it
(every table references the user with `ON DELETE CASCADE`).


### Sources we do not use

**LinkedIn** has no public job-search API (its job API is for partners who post jobs), and its terms prohibit scraping, so it is not a source. Indeed and Glassdoor are the same. Keyed aggregators such as Adzuna and Jooble are possible later if you obtain a key. Check each board's own terms before relying on it: Himalayas asks that its jobs not be resubmitted to third-party sites, Jobicy asks for credit and at most one poll an hour, and Remotive delays its feed by 24 hours.


## Jobs with an application link or an email (how they are handled)

A listing is applied for by one of three ways, in this order:

1. **Its form, filled in for you**, when the link is on a site whose form the app has been checked
   against (Greenhouse and Ashby by default; more only through `AUTOAPPLY_FORM_HOSTS`, after they have
   been checked read-only on real forms). Needs the "employers' forms" channel on.
2. **Email**, when the listing itself tells people to apply by email. The address is read from the
   listing's own words ("send your CV to ..."): only an address in a sentence about applying counts,
   never a support, no-reply or placeholder address, and when the text gives two different
   application addresses nothing is guessed. The sentence is kept as the evidence. Needs the "email"
   channel on and a connected mailbox. Listings stored before this was read are filled in by the
   worker's hourly housekeeping, 500 at a time.
3. **Hand-off: "Ready for you to apply".** A job that fits but whose link is on a site we cannot fill
   in (or whose only route is a channel you switched off) is no longer skipped. The CV and the note
   are prepared as for any application, and the job shows the link, copy buttons for both, and
   "I've applied" and "Skip this role". Nothing is sent by the app, it never counts as sent by
   Auto-Apply, and "Applied by you" is its own status, so the numbers say which was which.

A job with no link and no email still cannot be acted on and is skipped, with the reason.

Why not submit every site's form: most employer sites have their own bot checks (CAPTCHA and the
like) and different forms; the app does not work round those, and it does not submit to a site it has
not been checked against. Adding a site is a decision made after reading its real form.
