import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  useCompanies,
  useCreateSession,
  useMe,
  useNotes,
} from "../../api/hooks";
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
  const { data: me } = useMe();
  const agreedBefore = me?.practice_consent === true;
  const [ticked, setTicked] = useState(false);
  const consent = agreedBefore || ticked;
  // One idempotency key per attempt, so a double click cannot start two sessions.
  const key = useRef(crypto.randomUUID());

  const cvUploaded = (notes.data?.content ?? "").trim().length > 0;
  const chosen = choice !== "";
  const ready = cvUploaded && chosen && consent;
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
    <main className="page-narrow">
      <h1 className="text-3xl font-semibold tracking-tight">
        Start a practice call
      </h1>
      <p className="text-sm text-muted">
        Practice with a friend, mentor or peer who knows the assistant is on.
        Join them on Google Meet, then share the Meet tab with its audio on the
        next screen.
      </p>

      <section aria-labelledby="co-h" className="card space-y-2">
        <h2 id="co-h" className="text-lg font-semibold">
          Company
        </h2>
        <label htmlFor="company" className="block text-sm font-medium">
          Which company are you practising for?
        </label>
        <select
          id="company"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="input w-full"
        >
          <option value="">Choose…</option>
          <option value={NONE}>No company (use my CV only)</option>
          {companies.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {company && isActive(company.job_status) && (
          <p role="status" className="text-sm text-amber-800">
            This company is still being researched. Outlines will use your CV
            only until the brief is ready (the brief is chosen when the session
            starts).
          </p>
        )}
        {company &&
          !isActive(company.job_status) &&
          !company.last_researched_at && (
            <p className="text-sm text-amber-800">
              No brief yet, so outlines for this company will use your CV alone.
            </p>
          )}
        {age !== null && age > 7 && (
          <p className="text-sm text-amber-800">
            The brief is {age} days old. Consider researching again first.
          </p>
        )}
      </section>

      {agreedBefore ? (
        <section aria-labelledby="consent-h" className="card space-y-1">
          <h2 id="consent-h" className="text-lg font-semibold">
            Your practice partner
          </h2>
          <p className="text-sm leading-relaxed">
            Your partner must know the assistant is listening to the call and
            transcribing it. You agreed to this when you signed up.
          </p>
          <p className="text-xs text-muted">
            Want to be asked before every session instead?{" "}
            <Link to="/settings" className="text-accent-dark underline">
              Change it in Settings
            </Link>
            .
          </p>
        </section>
      ) : (
        <section aria-labelledby="consent-h" className="card space-y-2">
          <h2 id="consent-h" className="text-lg font-semibold">
            Consent
          </h2>
          <label className="flex items-start gap-3 py-1 text-sm leading-relaxed">
            <input
              type="checkbox"
              checked={ticked}
              onChange={(e) => setTicked(e.target.checked)}
              className="mt-0.5 h-6 w-6 shrink-0 accent-accent"
            />
            <span>
              I confirm my practice partner knows this assistant is listening to
              the call and transcribing it, and agrees. This is for practice
              only, and I will follow local law on recording and transcribing
              calls.
            </span>
          </label>
          <p className="text-xs text-muted">
            {me?.consent_each_time
              ? "You asked to be asked before every session."
              : "You will not be asked again; you can change that in Settings."}{" "}
            Audio is relayed for transcription and discarded; only text is
            saved. Audio and text are processed by OpenAI to transcribe and
            write answers.
          </p>
        </section>
      )}

      <section aria-labelledby="ready-h" className="card">
        <h2 id="ready-h" className="mb-2 text-lg font-semibold">
          Readiness
        </h2>
        <ul className="space-y-1 text-sm">
          <Tick ok={cvUploaded}>
            CV uploaded{" "}
            {!cvUploaded && (
              <Link to="/notes" className="text-accent-dark underline">
                Upload your CV
              </Link>
            )}
          </Tick>
          <Tick ok={chosen}>Company chosen (or &quot;no company&quot;)</Tick>
          <Tick ok={consent}>
            {agreedBefore
              ? "Partner consent: agreed at sign-up"
              : "Partner consent confirmed"}
          </Tick>
        </ul>
      </section>

      {create.isError && (
        <p role="alert" className="notice-error">
          {create.error.message}
        </p>
      )}
      <button
        className="btn-primary"
        disabled={!ready || create.isPending}
        onClick={start}
      >
        {create.isPending ? "Starting…" : "Start session"}
      </button>
    </main>
  );
}
