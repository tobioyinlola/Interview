import { useState } from "react";

import { useAutoApplyAdmin, useFlipSwitch } from "./api";
import {
  DaysSelect,
  Empty,
  Failed,
  Loading,
  PageHead,
  Stat,
  Table,
  num,
} from "./ui";
import { WorkerPanel } from "./WorkerPanel";

const SWITCHES: [string, string][] = [
  ["global", "Stop all new sends"],
  ["channel:form", "Stop employer forms"],
  ["channel:email", "Stop emailed applications"],
  ["channel:outreach", "Stop notes to hiring contacts"],
  ["provider:gmail", "Stop everything that uses Gmail"],
];

/** How Auto-Apply is doing, what is stuck, and the switches that stop it. */
export function AutoApplyAdminPage() {
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState("");
  const q = useAutoApplyAdmin(days);
  const flip = useFlipSwitch();
  if (q.isPending) return <Loading what="Auto-Apply" />;
  if (q.isError) return <Failed what="Auto-Apply" />;
  const d = q.data;
  const on = new Set(d.switches.filter((s) => s.on).map((s) => s.name));
  const sent = d.applications_by_status;
  return (
    <div className="space-y-6">
      <PageHead
        title="Auto-Apply"
        intro="Searches that are running, what has gone out, anything whose outcome is unknown, and the switches that stop sending. It shows counts only, never anyone's CV or answers."
        right={<DaysSelect days={days} onChange={setDays} />}
      />
      {!d.enabled && (
        <p role="status" className="notice-warn">
          Auto-Apply is switched off on this server (AUTOAPPLY_ENABLED), so
          nobody can use it.
        </p>
      )}
      <dl
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="Auto-Apply totals"
      >
        <Stat
          label="Searches running"
          value={num(d.campaigns_active)}
          hint={`${d.campaigns_paused} paused`}
        />
        <Stat
          label="Started"
          value={num(d.campaigns_started)}
          hint={`${d.campaigns_ended} finished`}
        />
        <Stat
          label="Applications sent"
          value={num(d.applications_sent)}
          hint={`${num(sent.needs_input ?? 0)} waiting on a person`}
        />
        <Stat label="Interviews" value={num(d.interviews)} />
        <Stat
          label="Invitations per 100"
          value={d.invitations_per_100 === null ? "–" : d.invitations_per_100}
          hint={
            d.invitations_per_100 === null
              ? "Needs applications a month old"
              : `of ${d.cohort_size} sent 30 to 60 days ago`
          }
        />
        <Stat
          label="Hours to first application"
          value={d.hours_to_first_application ?? "–"}
        />
        <Stat
          label="Unknown outcomes"
          value={num(d.attempts_unresolved)}
          hint={`${d.attempts_failed} failed`}
        />
        <Stat
          label="Replies to match"
          value={num(d.events_needing_review)}
          hint="waiting on a person"
        />
      </dl>

      <section aria-labelledby="sw-h" className="space-y-3">
        <h2 id="sw-h" className="text-base font-semibold tracking-tight">
          Switches
        </h2>
        <p className="text-sm text-muted">
          A switch stops new sends at once. History stays, replies are still
          read, and anything already sent is still settled.
        </p>
        <label className="block text-sm">
          <span className="mr-2 text-muted">Reason (shown to the team)</span>
          <input
            className="input w-72"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <ul className="space-y-2">
          {SWITCHES.map(([name, label]) => (
            <li
              key={name}
              className="card !p-3 flex flex-wrap items-center justify-between gap-2"
            >
              <span>
                {label}
                {on.has(name) && (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900">
                    ON
                  </span>
                )}
              </span>
              <button
                type="button"
                className={on.has(name) ? "btn-secondary" : "btn-primary"}
                disabled={flip.isPending}
                onClick={() => flip.mutate({ name, on: !on.has(name), reason })}
              >
                {on.has(name) ? `Turn off: ${label}` : `Turn on: ${label}`}
              </button>
            </li>
          ))}
        </ul>
        {flip.isError && (
          <p role="alert" className="notice-error">
            That switch could not be changed.
          </p>
        )}
      </section>

      <section aria-labelledby="un-h" className="space-y-3">
        <h2 id="un-h" className="text-base font-semibold tracking-tight">
          Sends with an unknown outcome
        </h2>
        {d.unresolved.length === 0 ? (
          <Empty>None. Everything that went out has been confirmed.</Empty>
        ) : (
          <Table
            label="Unknown outcomes"
            head={["Person", "Role", "Way", "State", "Waiting"]}
          >
            {d.unresolved.map((r) => (
              <tr key={r.application_id}>
                <td className="px-4 py-3">{r.person}</td>
                <td className="px-4 py-3">
                  {r.title} at {r.company}
                </td>
                <td className="px-4 py-3">{r.channel}</td>
                <td className="px-4 py-3">{r.state}</td>
                <td className="px-4 py-3">{r.age_hours} h</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section aria-labelledby="sys-h" className="space-y-2 text-sm">
        <h2 id="sys-h" className="text-base font-semibold tracking-tight">
          This server
        </h2>
        <p>
          Mailbox provider: {d.provider}. Real sending allowed: forms{" "}
          {d.dispatch.form ? "yes" : "no"}, email{" "}
          {d.dispatch.email ? "yes" : "no"}, notes{" "}
          {d.dispatch.outreach ? "yes" : "no"}.
        </p>
        <p>
          Mailboxes:{" "}
          {Object.entries(d.mailboxes)
            .map(([k, v]) => `${v} ${k.replace("_", " ")}`)
            .join(", ") || "none connected"}
          . Searches in the last 24 hours:{" "}
          {Object.entries(d.discovery_runs)
            .map(([k, v]) => `${v} ${k}`)
            .join(", ") || "none"}
          .
        </p>
      </section>
      <WorkerPanel />
    </div>
  );
}
