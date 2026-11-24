# Startup outreach

Finds startups in accelerators' public directories, reads what each one publishes about itself,
and writes to a published contact on a candidate's behalf, from the candidate's own connected
mailbox. It is separate from Auto-Apply (job listings) and works for any role, not only product.

## Where it lives

Startups are the second tab of Auto-Apply (Jobs | Startups), on every device. It shares Auto-Apply's
search roles, name, mailbox and one pause: pausing Auto-Apply pauses startup pitches too. The
Auto-Apply overview shows how many pitches wait for you. A role found on a startup's careers page
can be added to Auto-Apply with one tap, and then goes through the same checks as any pasted job.

## What it does, step by step

1. **Directories.** 11 accelerators' public portfolio pages are built in (Y Combinator, Techstars,
   Seedcamp, Antler, Alchemist, 500 Global, Startupbootcamp, Station F, Wayra UK, Village Global,
   Capital Factory). Each is read a couple at a time and again every week by the scheduler. The
   back office (Startups page, `/api/admin/startups`) turns each on or off, reads one now, adds
   more, and takes pasted companies for pages that only show in a browser. A model
   copies out name, website, one-liner, country; websites are validated and de-duplicated by
   domain. Region (us / eu / uk) comes from the company's country; a regional directory (e.g. Station F)
   supplies a region only for companies whose page gives no country, and a global directory never
   does, so a company with no known region is left alone rather than guessed. Pages built only in the browser may
   yield nothing to a polite fetcher: use import for those.
2. **Research** (`hunt/research.py`, runs in the scheduler, a few startups per pass). Fetches the
   startup's home, about, team, careers, jobs, contact pages (robots.txt respected, one request a
   second). Keeps only addresses *published on those pages, on the startup's own domain*, with the
   page they came from. Nothing is guessed, patterned from a name, or bought. A person's name is
   kept only if it appears in the page text. It also finds the careers page (the startup's own
   link, including to a job board such as Ashby, Lever or Greenhouse) and records each opening
   with its link, falling back to the careers page when an opening has no link of its own.
   A summary is stored too.
3. **Fit** (`hunt/fit.py`). Deterministic score from the candidate's roles and verified CV
   facts against the startup's published text; every point has a reason shown to the candidate.
4. **Draft** (`hunt/draft.py`). Short (under 100 words), and it names the matching opening. The model may use only the candidate's confirmed facts, their own
   pitch, and the startup's published facts. Numbers must appear in those facts; over-long or
   ungrounded drafts fall back to a plain template. The disclosure footer is added by code.
5. **Approve.** By default every note waits for the candidate. They can switch on auto-send.
6. **Send** (`hunt/engine.py`). One at a time, weekdays 08:00-18:00 in the candidate's timezone,
   at most `daily_cap` (max 25) a day, at least 90 s apart, from their mailbox. Atomic claim,
   stable Message-ID, unknown outcomes settled by looking in the mailbox, never re-sent.
7. **After.** One follow-up after five quiet days. Replies stop all follow-ups. An opt-out
   suppresses the address and the company's domain for that candidate. A bounce suppresses the
   address for everyone.

## Rules every note follows (`hunt/policy.py`)

Honest sender and a real postal address; a plain "reply no thanks" way out and a line saying
where the address was found; EU/UK notes add a legitimate-interest line; company addresses only
(free-mail rejected), only on the startup's own domain, never `privacy@`, `legal@`, `support@`
and similar; first note plus one follow-up at most; nobody who asked us to stop. This is
engineering policy, not legal advice. Nigerian NDPA treatment is not reviewed.

## Switches

- `STARTUP_OUTREACH_ENABLED` - routes (404 when off) and the scheduler job. Default false.
- `STARTUP_OUTREACH_DISPATCH` - allows a *real* mailbox to send. Default false. Outside
  production a real mailbox may only write to `AUTOAPPLY_ALLOWED_RECIPIENTS`.
- Kill switches `global` and `channel:hunt` (back office) stop dispatch immediately.

## What was and was not verified

Tested with fakes: policy, directory parsing, research, fit, drafting rules, planning, sending
rules, caps, windows, suppression, replies, opt-outs, bounces, follow-up, ambiguous sends, API
and UI. **Not** verified live from the build environment (no outbound network): real directory
pages, real startup sites, Gmail sending and the restricted `gmail.readonly` scope needed to
read replies. Test on a staging mailbox with `STARTUP_OUTREACH_DISPATCH` and a recipient
allowlist before opening it to anyone.
