import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  useBilling,
  useCompanies,
  useCreateSession,
  useNotes,
} from "../../api/hooks";
import { isActive } from "../../api/polling";
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

export function SessionSetupPage() {
  const notes = useNotes();
  const companies = useCompanies();
  const create = useCreateSession();
  const navigate = useNavigate();
  // Coming from Auto-Apply: the interview carries its own company, CV and job.
  const interviewId = useSearchParams()[0].get("interview") ?? undefined;
  const [choice, setChoice] = useState(interviewId ? NONE : "");
  const [audioMode, setAudioMode] = useState<"dual" | "device" | "mic">("dual");
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
  const ready = (interviewId ? true : cvUploaded && chosen) && !noCredit;
  const company = companies.data?.find((c) => c.id === choice);
  const age = daysSince(company?.last_researched_at);

  const start = () => {
    create.mutate(
      {
        companyId: choice === NONE ? null : choice,
        role: notes.data?.role || undefined,
        key: key.current,
        interviewId,
      },
      {
        onSuccess: (res) =>
          navigate(`/session/${res.session_id}`, {
            state: { sampleRate: res.sample_rate, audioMode },
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
          ? "Run a mock interview with a friend, mentor or peer who knows the assistant is on. On the next screen the assistant captures your interview audio directly or through the microphone. You can also type a question."
          : "Run a mock interview with a friend, mentor or peer who knows the assistant is on. Join them on Google Meet, then share the Meet tab with its audio on the next screen."}
      </p>

      {isMobileApp() && (
        <section aria-labelledby="audio-mode-h" className="card space-y-3">
          <h2 id="audio-mode-h" className="text-lg font-semibold">
            Audio recording
          </h2>
          <p className="text-sm text-muted">
            Choose what to record during your interview:
          </p>
          <div className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="audioMode"
                value="dual"
                checked={audioMode === "dual"}
                onChange={() => setAudioMode("dual")}
                className="mt-1"
              />
              <div>
                <span className="text-sm font-medium">Device audio and microphone</span>
                <p className="text-xs text-muted">
                  Captures internal meeting audio (interviewer) and your microphone (you) as separate streams.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="audioMode"
                value="device"
                checked={audioMode === "device"}
                onChange={() => setAudioMode("device")}
                className="mt-1"
              />
              <div>
                <span className="text-sm font-medium">Device audio</span>
                <p className="text-xs text-muted">
                  Captures only the interviewer voice directly from your meeting app (Zoom, Google Meet, Teams).
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="audioMode"
                value="mic"
                checked={audioMode === "mic"}
                onChange={() => setAudioMode("mic")}
                className="mt-1"
              />
              <div>
                <span className="text-sm font-medium">Microphone only (Speakerphone)</span>
                <p className="text-xs text-muted">
                  Single microphone fallback for cellular phone calls or when meeting apps restrict audio capture.
                </p>
              </div>
            </label>
          </div>
        </section>
      )}

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

      <p className="text-xs leading-relaxed text-muted">
        Your interview partner must know this assistant is listening to the call
        and transcribing it. This is for mock interviews only, so follow local
        law on recording and transcribing calls. Audio is relayed for
        transcription and discarded; only text is saved. Audio and text are
        processed by OpenAI to transcribe and write answers.
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
