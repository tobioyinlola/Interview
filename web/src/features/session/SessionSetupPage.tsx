import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useCompanies, useCreateSession, useNotes } from "../../api/hooks";
import { isActive } from "../../api/polling";
import { daysSince } from "../companies/ResearchStatus";

const NONE = "none";

function Tick({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true">{ok ? "✓" : "○"}</span>
      <span className={ok ? "" : "text-muted"}>
        <span className="sr-only">{ok ? "Done: " : "Not done: "}</span>
        {children}
      </span>
    </li>
  );
}

export function SessionSetupPage() {
  const notes = useNotes();
  const companies = useCompanies();
  const create = useCreateSession();
  const navigate = useNavigate();
  const [choice, setChoice] = useState("");
  const [consent, setConsent] = useState(false);
  // One idempotency key per attempt, so a double click cannot start two sessions.
  const key = useRef(crypto.randomUUID());

  const notesSaved = (notes.data?.content ?? "").trim().length > 0;
  const chosen = choice !== "";
  const ready = notesSaved && chosen && consent;
  const company = companies.data?.find((c) => c.id === choice);
  const age = daysSince(company?.last_researched_at);

  const start = () => {
    create.mutate(
      {
        companyId: choice === NONE ? null : choice,
        role: notes.data?.role || undefined,
        key: key.current,
      },
      {
        onSuccess: (res) =>
          navigate(`/session/${res.session_id}`, {
            state: { sampleRate: res.sample_rate },
          }),
        onError: () => {
          key.current = crypto.randomUUID();
        },
      },
    );
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Start a practice call</h1>
      <p className="text-sm text-muted">
        Practice with a friend, mentor or peer who knows the assistant is on.
        Join them on Google Meet, then share the Meet tab with its audio on the
        next screen.
      </p>

      <section aria-labelledby="co-h" className="space-y-2">
        <h2 id="co-h" className="text-lg font-medium">
          Company
        </h2>
        <label htmlFor="company" className="block text-sm font-medium">
          Which company are you practising for?
        </label>
        <select
          id="company"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="w-full rounded border px-3 py-2"
        >
          <option value="">Choose…</option>
          <option value={NONE}>No company (use my notes only)</option>
          {companies.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {company && isActive(company.job_status) && (
          <p role="status" className="text-sm text-amber-800">
            This company is still being researched. Outlines will use your notes
            only until the brief is ready (the brief is chosen when the session
            starts).
          </p>
        )}
        {company &&
          !isActive(company.job_status) &&
          !company.last_researched_at && (
            <p className="text-sm text-amber-800">
              No brief yet, so outlines for this company will use your notes
              alone.
            </p>
          )}
        {age !== null && age > 7 && (
          <p className="text-sm text-amber-800">
            The brief is {age} days old. Consider researching again first.
          </p>
        )}
      </section>

      <section
        aria-labelledby="consent-h"
        className="space-y-2 rounded border p-4"
      >
        <h2 id="consent-h" className="text-lg font-medium">
          Consent
        </h2>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1"
          />
          <span>
            I confirm my practice partner knows this assistant is listening to
            the call and transcribing it, and agrees. This is for practice only,
            and I will follow local law on recording and transcribing calls.
          </span>
        </label>
        <p className="text-xs text-muted">
          Audio is relayed for transcription and discarded; only text is saved.
          Audio and text are processed by OpenAI to transcribe and write
          outlines.
        </p>
      </section>

      <section aria-labelledby="ready-h">
        <h2 id="ready-h" className="mb-2 text-lg font-medium">
          Readiness
        </h2>
        <ul className="space-y-1 text-sm">
          <Tick ok={notesSaved}>
            Notes saved{" "}
            {!notesSaved && (
              <Link to="/notes" className="text-accent-dark underline">
                Add your notes
              </Link>
            )}
          </Tick>
          <Tick ok={chosen}>Company chosen (or &quot;no company&quot;)</Tick>
          <Tick ok={consent}>Partner consent confirmed</Tick>
        </ul>
      </section>

      {create.isError && (
        <p
          role="alert"
          className="rounded border border-red-700 p-3 text-sm text-red-800"
        >
          {create.error.message}
        </p>
      )}
      <button
        className="rounded bg-accent px-4 py-2 text-white disabled:opacity-50"
        disabled={!ready || create.isPending}
        onClick={start}
      >
        {create.isPending ? "Starting…" : "Start session"}
      </button>
    </main>
  );
}
