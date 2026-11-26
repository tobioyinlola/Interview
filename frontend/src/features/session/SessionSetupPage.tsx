import { type FormEvent, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  useBilling,
  useCompanies,
  useCreateCompany,
  useCreateSession,
  useNotes,
} from "../../api/hooks";
import { isActive } from "../../api/polling";
import { type InterviewMode, MODES } from "./modes";
import { isMobileApp } from "../../app/native";
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

/** No company to pick? Add the one interviewing you right here: it is researched, and chosen. */
function AddCompany({
  role,
  onAdded,
}: {
  role: string;
  onAdded: (id: string) => void;
}) {
  const create = useCreateCompany();
  const key = useRef(crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        key: key.current,
        input: {
          name: name.trim(),
          website_url: site.trim() || null,
          job_posting_url: null,
          extra_links: [],
          role,
          known_text: "",
        },
      },
      {
        onSuccess: (r) => {
          key.current = crypto.randomUUID();
          setOpen(false);
          setName("");
          setSite("");
          onAdded(r.company.id);
        },
        onError: () => {
          key.current = crypto.randomUUID();
        },
      },
    );
  };
  if (!open)
    return (
      <button
        type="button"
        className="btn-secondary w-fit"
        onClick={() => setOpen(true)}
      >
        Add a company
      </button>
    );
  return (
    <form
      onSubmit={submit}
      aria-label="Add a company"
      className="space-y-3 rounded-2xl bg-canvas p-4"
    >
      <p className="text-sm text-muted">
        The company interviewing you, not an employer you have worked for. We
        research what they do so every answer fits them.
      </p>
      <div>
        <label htmlFor="new-co" className="block text-sm font-medium">
          Company name
        </label>
        <input
          id="new-co"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input mt-1 w-full"
        />
      </div>
      <div>
        <label htmlFor="new-co-site" className="block text-sm font-medium">
          Website <span className="font-normal text-muted">(recommended)</span>
        </label>
        <input
          id="new-co-site"
          type="url"
          placeholder="https://"
          value={site}
          onChange={(e) => setSite(e.target.value)}
          className="input mt-1 w-full"
        />
      </div>
      {create.isError && (
        <p role="alert" className="notice-error">
          {create.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="btn-primary"
          disabled={!name.trim() || create.isPending}
        >
          {create.isPending ? "Adding…" : "Add and research"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function SessionSetupPage() {
  const notes = useNotes();
  const companies = useCompanies();
  const create = useCreateSession();
  const navigate = useNavigate();
  // Coming from Auto-Apply: the interview carries its own company, CV and job.
  const interviewId = useSearchParams()[0].get("interview") ?? undefined;
  const [choice, setChoice] = useState(interviewId ? NONE : "");
  const [mode, setMode] = useState<InterviewMode>("mock");
  const [authorized, setAuthorized] = useState(false);
  const [authorizedBy, setAuthorizedBy] = useState("");
  const authOk =
    mode !== "assisted" || (authorized && authorizedBy.trim() !== "");
  // One idempotency key per attempt, so a double click cannot start two sessions.
  const key = useRef(crypto.randomUUID());

  const billing = useBilling();
  // Only a loaded answer of "none left" blocks; while it loads, or if it fails, the server decides.
  const noCredit =
    billing.data !== undefined &&
    !billing.data.sessions_free &&
    billing.data.sessions_available < 1;
  const cvUploaded = (notes.data?.content ?? "").trim().length > 0;
  const chosen = choice !== "";
  const ready =
    (interviewId ? true : cvUploaded && chosen) && !noCredit && authOk;
  const company = companies.data?.find((c) => c.id === choice);
  const age = daysSince(company?.last_researched_at);

  const start = () => {
    create.mutate(
      {
        companyId: choice === NONE ? null : choice,
        role: notes.data?.role || undefined,
        key: key.current,
        interviewId,
        mode,
        authorizedBy: authorizedBy.trim(),
      },
      {
        onSuccess: (res) =>
          navigate(`/session/${res.session_id}`, {
            state: {
              sampleRate: res.sample_rate,
              mode,
              authorizedBy: mode === "assisted" ? authorizedBy.trim() : null,
            },
          }),
        onError: () => {
          key.current = crypto.randomUUID();
        },
      },
    );
  };

  return (
    <main className="page-reading">
      <h1 className="text-3xl font-semibold tracking-tight">
        Start an interview
      </h1>
      <p className="text-sm text-muted">
        {isMobileApp()
          ? "Run a mock interview with a friend, mentor or peer who knows the assistant is on. On the next screen the phone listens through its microphone, so put it near the speaker of your call. You can also type a question."
          : "Run a mock interview with a friend, mentor or peer who knows the assistant is on. Join them on Google Meet, then share the Meet tab with its audio on the next screen."}
      </p>

      {interviewId ? (
        <section aria-labelledby="co-h" className="card space-y-2">
          <h2 id="co-h" className="text-lg font-semibold">
            Your interview
          </h2>
          <p className="text-sm">
            This session starts from your Auto-Apply interview. The assistant
            will use the CV you submitted and the job as it was when you
            applied.
          </p>
        </section>
      ) : (
        <section aria-labelledby="co-h" className="card space-y-2">
          <h2 id="co-h" className="text-lg font-semibold">
            Company
          </h2>
          <label htmlFor="company" className="block text-sm font-medium">
            Which company are you interviewing with?
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
          <AddCompany role={notes.data?.role ?? ""} onAdded={setChoice} />
          {company && isActive(company.job_status) && (
            <p role="status" className="text-sm text-amber-800">
              This company is still being researched. Outlines will use your CV
              only until the brief is ready (the brief is chosen when the
              session starts).
            </p>
          )}
          {company &&
            !isActive(company.job_status) &&
            !company.last_researched_at && (
              <p className="text-sm text-amber-800">
                No brief yet, so outlines for this company will use your CV
                alone.
              </p>
            )}
          {age !== null && age > 7 && (
            <p className="text-sm text-amber-800">
              The brief is {age} days old. Consider researching again first.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="mode-h" className="card space-y-3">
        <h2 id="mode-h" className="text-lg font-semibold">
          What kind of interview?
        </h2>
        <div
          role="radiogroup"
          aria-labelledby="mode-h"
          className="grid gap-2 sm:grid-cols-3"
        >
          {MODES.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer flex-col gap-1 rounded-xl p-3 text-sm ${
                mode === m.id
                  ? "bg-accent-soft ring-2 ring-accent"
                  : "bg-canvas"
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="mode"
                  value={m.id}
                  checked={mode === m.id}
                  onChange={() => setMode(m.id)}
                  className="accent-accent"
                />
                {m.title}
              </span>
              <span className="text-muted">{m.line}</span>
            </label>
          ))}
        </div>
        {mode === "assisted" && (
          <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(e) => setAuthorized(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
              />
              <span>
                The interviewer or the organisation has told me I may use
                real-time assistance in this interview.
              </span>
            </label>
            <label className="block">
              <span className="font-medium">Who said so, and how?</span>
              <input
                value={authorizedBy}
                maxLength={200}
                onChange={(e) => setAuthorizedBy(e.target.value)}
                placeholder="e.g. Jo Smith, recruiter at Acme, by email on 25 Nov"
                className="input mt-1 w-full"
              />
            </label>
            <p className="text-xs">
              This is kept with the session. Without that permission, choose
              Standard interview: you still get the transcript and feedback.
            </p>
          </div>
        )}
      </section>

      <p className="text-xs leading-relaxed text-muted">
        Everyone on the call must know this assistant is listening and
        transcribing it. Follow local law on recording and transcribing calls.
        Audio is relayed for transcription and discarded; only text is saved.
        Audio and text are processed by OpenAI to transcribe and write answers.
      </p>

      <section aria-labelledby="ready-h" className="card">
        <h2 id="ready-h" className="mb-2 text-lg font-semibold">
          Readiness
        </h2>
        <ul className="space-y-1 text-sm">
          {interviewId ? (
            <Tick ok>Interview opened from Auto-Apply</Tick>
          ) : (
            <>
              <Tick ok={cvUploaded}>
                CV uploaded{" "}
                {!cvUploaded && (
                  <Link
                    to="/settings/cv"
                    className="text-accent-dark underline"
                  >
                    Upload your CV
                  </Link>
                )}
              </Tick>
              <Tick ok={chosen}>
                Company chosen (or &quot;no company&quot;)
              </Tick>
            </>
          )}
        </ul>
      </section>

      {noCredit && (
        <section
          aria-labelledby="pay-h"
          className="card space-y-2 !bg-amber-50"
        >
          <h2 id="pay-h" className="text-lg font-semibold">
            You have used your free session
          </h2>
          <p className="text-sm">
            More sessions will be pay per session, and payments are coming soon.
            Until then you can earn a free session by inviting{" "}
            {billing.data?.referrals_per_reward ?? 3} friends.
          </p>
          <Link to="/referrals" className="btn-primary w-fit">
            Invite friends
          </Link>
        </section>
      )}
      {billing.data?.sessions_free && (
        <p className="text-sm text-muted">
          Sessions are free while we test, so start as many as you like.
        </p>
      )}
      {billing.data && !billing.data.sessions_free && !noCredit && (
        <p className="text-sm text-muted">
          This uses one of your {billing.data.sessions_available} available{" "}
          {billing.data.sessions_available === 1 ? "session" : "sessions"}
          {billing.data.trial_available ? " (your free trial)" : ""}.
        </p>
      )}
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
