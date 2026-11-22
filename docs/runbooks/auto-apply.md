# Auto-Apply runbook

Alerts that point here: `AutoApplySchedulerStalled`, `AutoApplyQueueBacklog`,
`AutoApplyUnknownOutcomes`, `AutoApplyMailboxStale`, `AutoApplyFormsChanging`,
`AutoApplyDiscoveryFailing`.

## First, stop new sends if anything looks wrong

Back office → **Auto-Apply** → switches. Turn on `global` to stop every new send, or one of
`channel:form`, `channel:email`, `channel:outreach`, `provider:<name>` (for example
`provider:gmail`). It takes effect on the next claim, with no deploy. Application history is kept,
replies are still read, and attempts already sent are still settled, so a rollback never loses
track of what went out.

## Scheduler stalled

The scheduler runs inside the API process (`AUTOAPPLY_ENABLED=true`, `AUTOAPPLY_TICK_SECONDS`).
Check the API logs for `auto-apply tick failed`. A pass that throws is logged and retried on the
next tick; a stall means the process is down or the event loop is blocked. Restarting the API is
safe: every step claims its work in the database, so a second server or a restart cannot send
anything twice.

## Queue backlog

Applications wait when: the daily limit is reached, the candidate is outside their active hours, the
search is paused, a switch is on, or the mailbox needs reconnecting. Look at the back-office page
before assuming a fault.

## Unknown outcomes (a send whose result we did not see)

These stay counted against the candidate's daily limit and are **never** sent again by the system.
Each pass looks for evidence (the employer's receipt, or the message in the candidate's Sent mail).
After `AUTOAPPLY_RECONCILE_HOURS` the candidate is asked whether it went through; their answer
decides. If you must act: open the application in the back office list, confirm with the candidate,
and let them answer on their application page. Do not edit attempt rows by hand.

## Mailbox stale or needs reconnecting

`reauth_needed` means Google refused our access (revoked, expired, password change). Nothing is sent
or read until the candidate reconnects from Auto-Apply → Search preferences. Stale mailboxes with
status `connected` mean the read step is failing: check for `mailbox read failed` in the logs.

## Forms changing

`autoapply_form_changes_total` counts sends stopped because the employer's form asked something the
approved package could not answer. Those applications are waiting for the candidate with the exact
question. A spike usually means one employer changed its form; turn on `provider:<form adapter>` if it
keeps happening.

## Discovery failing

A failed run does not use up the candidate's day; the next pass tries again. Check the source's
status first (for Greenhouse, the board token in `AUTOAPPLY_GREENHOUSE_BOARDS` may be wrong).
