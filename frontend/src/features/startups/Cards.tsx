import { useState } from "react";

import { useAddJob } from "../autoapply/api";
import { useHuntDelivery, useTargetActions, type HuntTarget } from "./api";

export const STATUS: Record<string, string> = {
  drafted: "Waiting for you",
  approved: "Sending soon",
  sending: "Sending",
  sent: "Sent",
  replied: "They replied",
  declined: "They said no",
  skipped: "Skipped",
  failed: "Did not send",
};

/** The status of a note. An approved note is "Sending soon" only while nothing is in the way; when
 *  something is (see the notice at the top), it says "Held back" instead of promising it. */
export function StatusPill({
  t,
  className = "",
}: {
  t: HuntTarget;
  className?: string;
}) {
  const d = useHuntDelivery();
  const held = t.status === "approved" && (d.data?.blockers.length ?? 0) > 0;
  return (
    <span
      className={`${className} ${
        held ? "bg-amber-100 text-amber-900" : "bg-accent-soft text-accent-dark"
      }`}
      title={held ? d.data?.blockers[0]?.text : undefined}
    >
      {held ? "Held back" : (STATUS[t.status] ?? t.status)}
    </span>
  );
}

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
    : "";

/** The two things we do for each startup, side by side: the careers page, and the email pitch. */
function Careers({ t }: { t: HuntTarget }) {
  const add = useAddJob();
  const [added, setAdded] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded-2xl bg-canvas p-4">
      <h4 className="text-sm font-semibold">1 · Careers page</h4>
      {t.openings.length > 0 ? (
        <ul className="space-y-2">
          {t.openings.map((o) => (
            <li
              key={o.url + o.title}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="min-w-0 text-sm">
                <span className="font-medium">{o.title}</span>{" "}
                <span className="text-muted">is open</span>
              </span>
              <span className="flex gap-2">
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary btn-sm"
                >
                  View role
                </a>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={add.isPending || added === o.url}
                  onClick={() =>
                    add.mutate(o.url, { onSuccess: () => setAdded(o.url) })
                  }
                >
                  {added === o.url ? "Added" : "Add to Auto-Apply"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          No role that fits is listed right now
          {t.careers_url ? (
            <>
              .{" "}
              <a href={t.careers_url} target="_blank" rel="noreferrer">
                See their careers page
              </a>
            </>
          ) : (
            ", and we did not find a careers page."
          )}
        </p>
      )}
      {add.isError && (
        <p role="alert" className="text-sm text-red-700">
          {add.error instanceof Error
            ? add.error.message
            : "Could not add that role."}
        </p>
      )}
    </div>
  );
}

function Pitch({ t }: { t: HuntTarget }) {
  const { approve, skip, edit } = useTargetActions();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const waiting = t.status === "drafted";
  const text = body.split("\n--")[0].trim();
  return (
    <div className="space-y-3 rounded-2xl bg-canvas p-4">
      <h4 className="text-sm font-semibold">2 · Email pitch</h4>
      <p className="text-sm">
        To <b className="break-all">{t.contact}</b>, an address they published{" "}
        <a href={t.contact_source} target="_blank" rel="noreferrer">
          here
        </a>
        .
      </p>
      {editing && waiting ? (
        <div className="space-y-2">
          <input
            className="input w-full"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject"
          />
          <textarea
            className="input w-full"
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Pitch"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={edit.isPending}
              onClick={() =>
                edit.mutate(
                  { id: t.id, subject, body },
                  { onSuccess: () => setEditing(false) },
                )
              }
            >
              Save
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1 rounded-xl bg-surface p-3 text-sm">
          <p className="font-medium">{t.subject}</p>
          <p className="whitespace-pre-line text-muted">{text}</p>
        </div>
      )}
      <p className="text-xs text-muted">
        <span aria-hidden="true">📎</span> Your CV is attached as a PDF
        {waiting ? ". You can change the words before you send." : "."}
      </p>
      {waiting && !editing && (
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            disabled={approve.isPending}
            onClick={() => approve.mutate(t.id)}
          >
            Send pitch
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button className="btn-secondary" onClick={() => skip.mutate(t.id)}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

/** One startup, as a card: what they do, why they fit, then the careers page and the pitch. */
export function StartupCard({ t }: { t: HuntTarget }) {
  return (
    <li className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a
            href={t.website}
            target="_blank"
            rel="noreferrer"
            className="text-lg font-semibold"
          >
            {t.startup}
          </a>
          <p className="text-sm text-muted">{t.one_liner}</p>
        </div>
        <StatusPill
          t={t}
          className="rounded-full px-2.5 py-0.5 text-xs font-medium"
        />
      </div>
      {t.fit_reasons.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted">
            Why it fits you
          </summary>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted">
            {t.fit_reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}
      {t.reason && <p className="text-sm text-muted">{t.reason}</p>}
      <Careers t={t} />
      <Pitch t={t} />
    </li>
  );
}

/** A finished one is a single quiet row that opens to the full card. */
export function HistoryRow({ t }: { t: HuntTarget }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="list-card">
      <button
        type="button"
        className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-2 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{t.startup}</span>
          <span className="block truncate text-sm text-muted">
            {t.contact}
            {t.sent_at ? ` · ${when(t.sent_at)}` : ""}
          </span>
        </span>
        <StatusPill
          t={t}
          className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
        />
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          {t.reason && <p className="text-sm text-muted">{t.reason}</p>}
          <Careers t={t} />
          <Pitch t={t} />
        </div>
      )}
    </li>
  );
}
