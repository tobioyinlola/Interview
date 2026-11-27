import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { apiBlob } from "../../api/client";
import { Loading } from "../../ui/Loading";
import { useApplication, useApplicationActions } from "./api";
import { Fail, Pill, STAGE, Section, when } from "./ui";

type Need = {
  kind: string;
  field: string;
  question: string;
  reason: string;
  options?: string[];
};
type RuleRow = {
  key: string;
  label: string;
  required: boolean;
  status: string;
  evidence: string;
};

/** The CV prepared for this role as a PDF, in the look of the CV that was uploaded. */
function DownloadCv({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  return (
    <button
      type="button"
      className="btn-secondary"
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          const blob = await apiBlob(
            `/api/autoapply/applications/${id}/cv.pdf`,
          );
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "Tailored CV.pdf";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          setState("idle");
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "busy"
        ? "Preparing the PDF…"
        : state === "failed"
          ? "Could not download. Try again"
          : "Download CV (PDF)"}
    </button>
  );
}

/** Copies a prepared text, and says so; if the browser refuses, the text is on the page to select. */
function CopyButton({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2500);
      }}
    >
      {state === "copied"
        ? "Copied"
        : state === "failed"
          ? "Could not copy: select it below"
          : label}
    </button>
  );
}

function NeedForm({ need, id }: { need: Need; id: string }) {
  const act = useApplicationActions(id);
  const [value, setValue] = useState("");
  const [reuse, setReuse] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim())
      act.answer.mutate({
        field: need.field,
        value: value.trim(),
        save_for_reuse: reuse,
      });
  };
  const error = act.answer.error ?? act.approve.error ?? act.resolve.error;
  return (
    <li className="space-y-2 rounded-xl bg-canvas p-3">
      <p className="font-medium">{need.question}</p>
      <p className="text-sm text-muted">{need.reason}</p>
      {(need.kind === "answer" || need.kind === "declaration") && (
        <form onSubmit={submit} className="space-y-2">
          <label htmlFor={`n-${need.field}`} className="sr-only">
            {need.question}
          </label>
          {need.options && need.options.length > 0 ? (
            <select
              id={`n-${need.field}`}
              className="input w-full"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="">Choose…</option>
              {need.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`n-${need.field}`}
              className="input w-full"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          {need.kind === "answer" && (
            <label className="check text-xs text-muted">
              <input
                type="checkbox"
                checked={reuse}
                onChange={(e) => setReuse(e.target.checked)}
              />
              Reuse this answer next time
            </label>
          )}
          <button className="btn-primary" disabled={act.answer.isPending}>
            Save and continue
          </button>
        </form>
      )}
      {(need.kind === "rule" || need.kind === "duplicate") && (
        <button
          type="button"
          className="btn-secondary"
          disabled={act.approve.isPending}
          onClick={() => act.approve.mutate(need.field)}
        >
          {need.kind === "duplicate"
            ? "It is a different job. Go ahead"
            : "I have checked. Go ahead"}
        </button>
      )}
      {need.kind === "verify_facts" && (
        <Link to="/auto-apply/setup" className="btn-secondary">
          Check my details
        </Link>
      )}
      {need.kind === "confirm" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => act.resolve.mutate(true)}
          >
            Yes, it went through
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => act.resolve.mutate(false)}
          >
            No, send it again
          </button>
        </div>
      )}
      {need.kind === "unsupported" && (
        <p className="text-sm">
          Open the employer's form yourself to finish this one, or skip it.
        </p>
      )}
      <Fail error={error} />
    </li>
  );
}

export function ApplicationPage() {
  const { id = "" } = useParams();
  const q = useApplication(id);
  const act = useApplicationActions(id);
  const [contact, setContact] = useState("");
  if (q.isPending) return <Loading label="Loading application" />;
  if (q.isError || !q.data)
    return (
      <main className="page-reading">
        <p role="alert" className="notice-error">
          That application could not be found.
        </p>
        <Link
          to="/auto-apply/applications"
          className="text-accent-dark underline"
        >
          Back to applications
        </Link>
      </main>
    );
  const a = q.data;
  const rules = ((a.match as { rules?: RuleRow[] }).rules ?? []) as RuleRow[];
  const pkg = a.package as {
    cv: {
      submitted_text: string;
      tailoring: { mode: string; reverted: number[] };
    };
    cover_text: string;
    answers: Record<string, { value: string; source: string }>;
    destination: { channel: string; url?: string; to?: string };
  } | null;
  const sent = ["submitted", "sent_email", "confirmation_pending"].includes(
    a.status,
  );
  return (
    <main className="page-reading">
      <p className="text-sm">
        <Link
          to="/auto-apply/applications"
          className="text-accent-dark underline"
        >
          All applications
        </Link>
      </p>
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {a.posting.title}
        </h1>
        <p className="text-muted">
          {a.posting.company}
          {a.posting.region ? ` · ${a.posting.region}` : ""}
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <Pill status={a.status} />
          {a.recruiting_stage && (
            <span className="text-sm text-muted">
              {STAGE[a.recruiting_stage] ?? a.recruiting_stage}
            </span>
          )}
          {a.posting.application_url && (
            <a
              href={a.posting.application_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent-dark underline"
            >
              Open the job
            </a>
          )}
        </p>
        {a.skip_reason && <p className="text-sm">{a.skip_reason}</p>}
      </header>

      {a.status === "apply_yourself" && a.posting.application_url && pkg && (
        <Section
          id="own-h"
          title="Apply on the employer's site"
          hint="Auto-Apply cannot fill in this site's form, so your application is ready for you to submit there. Nothing has been sent."
        >
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Open the application (it opens in a new tab).</li>
            <li>Paste your CV and the note where the form asks for them.</li>
            <li>Come back here and press &ldquo;I&apos;ve applied&rdquo;.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <a
              href={a.posting.application_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              Open the application
            </a>
            <DownloadCv id={a.id} />
            <CopyButton label="Copy my CV" text={pkg.cv.submitted_text} />
            <CopyButton label="Copy the note" text={pkg.cover_text} />
            <button
              type="button"
              className="btn-secondary"
              disabled={act.applied.isPending}
              onClick={() => act.applied.mutate()}
            >
              I&apos;ve applied
            </button>
          </div>
          <Fail error={act.applied.error} />
          <button
            type="button"
            className="text-sm text-muted underline"
            onClick={() => act.skip.mutate()}
          >
            Skip this role
          </button>
        </Section>
      )}

      {a.needs_input.length > 0 && (
        <Section id="in-h" title="Needs your input">
          <ul className="space-y-3">
            {(a.needs_input as Need[]).map((n) => (
              <NeedForm key={`${n.kind}-${n.field}`} need={n} id={id} />
            ))}
          </ul>
          {a.status === "needs_input" && (
            <button
              type="button"
              className="text-sm text-muted underline"
              onClick={() => act.skip.mutate()}
            >
              Skip this role
            </button>
          )}
        </Section>
      )}

      {a.status === "skipped" && (
        <button
          type="button"
          className="btn-secondary"
          disabled={act.retry.isPending}
          onClick={() => act.retry.mutate()}
        >
          Check this role again
        </button>
      )}

      <Section
        id="why-h"
        title="Why it matched"
        hint="What each of your rules found."
      >
        <ul className="space-y-1 text-sm">
          {rules.map((r) => (
            <li key={r.key} className="flex gap-2">
              <span aria-hidden="true">
                {r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "?"}
              </span>
              <span>
                <span className="sr-only">
                  {r.status === "pass"
                    ? "Met: "
                    : r.status === "fail"
                      ? "Not met: "
                      : "Not clear: "}
                </span>
                <span className="font-medium">{r.label}</span>
                {r.required ? " (must)" : ""}: {r.evidence}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {pkg && (
        <Section
          id="pkg-h"
          title={
            sent
              ? "What was sent"
              : pkg.destination.channel === "manual"
                ? "What is ready for you"
                : "What will be sent"
          }
          hint="Your CV is sent exactly as you uploaded it, in our standard layout."
        >
          <p className="text-sm">
            {pkg.destination.channel === "form"
              ? "By the employer's form"
              : pkg.destination.channel === "manual"
                ? "For you to submit on the employer's site"
                : `By email to ${pkg.destination.to}`}
          </p>
          <div>
            <DownloadCv id={a.id} />
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              The CV that {sent ? "went" : "will go"} out
            </summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-xs">
              {pkg.cv.submitted_text}
            </pre>
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              The note with it
            </summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-canvas p-3 text-xs">
              {pkg.cover_text}
            </pre>
          </details>
          {Object.keys(pkg.answers).length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Answers given
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {Object.entries(pkg.answers).map(([k, v]) => (
                  <li key={k}>
                    <span className="font-medium">{k.replace("_", " ")}:</span>{" "}
                    {v.value}{" "}
                    <span className="text-xs text-muted">({v.source})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>
      )}

      {a.attempts.length > 0 && (
        <Section id="att-h" title="Sending">
          <ul className="space-y-1 text-sm">
            {a.attempts.map((t, i) => (
              <li key={i}>
                {t.channel === "outreach"
                  ? "Note to hiring contact"
                  : t.channel}
                : {t.state}
                {t.provider_ref ? ` · reference ${t.provider_ref}` : ""}
                {t.failure_message ? ` · ${t.failure_message}` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {sent && (
        <Section
          id="out-h"
          title="Hiring contact"
          hint="One short note per role, from your own email, within your daily limit."
        >
          {a.outreach ? (
            <div className="space-y-1 text-sm">
              <p>
                To {a.outreach.recipient}: {a.outreach.status}
                {a.outreach.reason ? ` (${a.outreach.reason})` : ""}
              </p>
              <pre className="whitespace-pre-wrap rounded-xl bg-canvas p-3 text-xs">
                {a.outreach.body}
              </pre>
            </div>
          ) : (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (contact.trim()) act.outreach.mutate(contact.trim());
              }}
            >
              <label htmlFor="contact" className="sr-only">
                Hiring contact's email
              </label>
              <input
                id="contact"
                type="email"
                className="input min-w-0 flex-1"
                placeholder="recruiter@company.com"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
              <button
                className="btn-secondary"
                disabled={act.outreach.isPending}
              >
                Write to them
              </button>
            </form>
          )}
          <Fail error={act.outreach.error} />
        </Section>
      )}

      <Section id="hist-h" title="History">
        <ol className="space-y-1 text-sm">
          {a.history.map((h, i) => (
            <li key={i}>
              <span className="text-muted">{when(h.created_at)}</span> ·{" "}
              {h.kind.replace(/_/g, " ")}
            </li>
          ))}
        </ol>
      </Section>
    </main>
  );
}
