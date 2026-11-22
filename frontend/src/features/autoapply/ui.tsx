import type { ReactNode } from "react";

/** How an application's state is said to the person. */
export const STATUS: Record<string, { label: string; tone: string }> = {
  discovered: { label: "Found", tone: "muted" },
  eligible: { label: "Matches", tone: "muted" },
  queued: { label: "Ready to send", tone: "info" },
  sending: { label: "Sending", tone: "info" },
  submitted: { label: "Submitted", tone: "good" },
  sent_email: { label: "Sent by email", tone: "good" },
  confirmation_pending: { label: "Confirming", tone: "warn" },
  needs_input: { label: "Needs your input", tone: "warn" },
  skipped: { label: "Skipped", tone: "muted" },
  failed: { label: "Failed", tone: "bad" },
};

export const STAGE: Record<string, string> = {
  acknowledged: "They received it",
  assessment: "Assessment",
  shortlisted: "Shortlisted",
  invited: "Invited to interview",
  interview_scheduled: "Interview booked",
  interview_cancelled: "Interview cancelled",
  rejected: "Not moving forward",
};

const TONES: Record<string, string> = {
  good: "bg-emerald-100 text-emerald-900",
  warn: "bg-amber-100 text-amber-900",
  bad: "bg-red-100 text-red-900",
  info: "bg-accent-soft text-accent-dark",
  muted: "bg-line text-muted",
};

export function Pill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "muted" };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[s.tone]}`}
    >
      {s.label}
    </span>
  );
}

export const when = (iso: string | null | undefined, zone?: string) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: zone,
      })
    : "";

export const day = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })
    : "";

export function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="card space-y-3">
      <div>
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function Fail({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="notice-error">
      {error instanceof Error ? error.message : "Something went wrong."}
    </p>
  );
}
