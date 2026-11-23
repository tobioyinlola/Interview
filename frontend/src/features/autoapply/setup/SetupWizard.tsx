import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useNotes } from "../../../api/hooks";
import { Loading } from "../../../ui/Loading";
import {
  useAAProfile,
  useAnswers,
  useDashboard,
  useFacts,
  useMailbox,
  useSaveAnswer,
  useSaveProfile,
} from "../api";
import { DemoNotice, Fail } from "../ui";
import { StepHeader } from "./controls";
import {
  type Draft,
  STEPS,
  type StepId,
  doneSteps,
  firstOpen,
  fromProfile,
  isStep,
  stepIndex,
  stepProblem,
  toProfileIn,
} from "./draft";
import { StepAnswers, type AnswerDraft, QUICK } from "./StepAnswers";
import { StepApply } from "./StepApply";
import { StepDetails } from "./StepDetails";
import { StepPreferences } from "./StepPreferences";
import { StepReview } from "./StepReview";
import { StepRole } from "./StepRole";
import { StepSchedule } from "./StepSchedule";

const INTRO: Record<StepId, string> = {
  details:
    "We read your CV so you do not have to type it all. Check it, fix anything, and confirm.",
  role: "Tell us the job you want and where you can work. This is the heart of your search.",
  preferences:
    "Fine-tune with the things you care about. Skip anything that does not matter.",
  schedule: "Decide when applications go out and how many a day.",
  apply: "Pick how we may apply for you. Each way is separate.",
  answers: "Employers keep asking the same questions. Answer once and be done.",
  review: "One last look. Then your 30 days begin.",
};

/** The guided setup: one step at a time, saved as you go, with a clear sense of progress. */
export function SetupWizard() {
  const profile = useAAProfile();
  const notes = useNotes();
  const facts = useFacts();
  const box = useMailbox();
  const dash = useDashboard();
  const answers = useAnswers();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const save = useSaveProfile();
  const saveAnswer = useSaveAnswer();

  const [d, setD] = useState<Draft | null>(null);
  const [drafts, setDrafts] = useState<AnswerDraft>({});
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const lastSaved = useRef<string>("");
  const top = useRef<HTMLDivElement>(null);

  // the draft starts from what is saved, once
  useEffect(() => {
    if (profile.data && !d) {
      const start = fromProfile(profile.data);
      setD(start);
      lastSaved.current = JSON.stringify(toProfileIn(start));
    }
  }, [profile.data, d]);

  const ctx = useMemo(
    () => ({
      factsConfirmed: !!facts.data?.verified_at && !facts.data.cv_changed,
      hasCv: (notes.data?.content ?? "").trim().length > 0,
      mailbox: !!box.data?.connected,
    }),
    [facts.data, notes.data, box.data],
  );
  const ready = !!d && !notes.isPending && !facts.isPending && !box.isPending;

  const asked = params.get("step");
  const current: StepId = useMemo(() => {
    if (!d || !ready) return "details";
    // a step opens once every required step before it is complete; anything else (an old link, a
    // typed address) lands on the first step that still needs something
    if (isStep(asked)) {
      const open = STEPS.slice(0, stepIndex(asked)).every(
        (x) => stepProblem(x.id, d, ctx) === null,
      );
      if (open) return asked;
    }
    return firstOpen(d, ctx);
  }, [asked, d, ready, ctx]);

  // with no step in the address, settle on the first step that needs something and keep it there,
  // so confirming a detail does not whisk the person on by itself
  useEffect(() => {
    if (ready && !isStep(asked) && d)
      setParams({ step: firstOpen(d, ctx) }, { replace: true });
  }, [ready, asked, d, ctx, setParams]);
  useEffect(() => {
    if (ready)
      setVisited((v) => (v.has(current) ? v : new Set(v).add(current)));
  }, [current, ready]);
  useEffect(() => {
    top.current?.scrollIntoView?.({ block: "start" });
  }, [current]);

  if (profile.isPending || !d || !ready)
    return <Loading label="Loading your search" />;
  if (profile.isError)
    return (
      <main className="page-narrow">
        <p role="alert" className="notice-error">
          Your search could not be loaded.
        </p>
      </main>
    );

  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const idx = stepIndex(current);
  const problem = stepProblem(current, d, ctx);
  const done = doneSteps(d, ctx, visited);
  const go = (s: StepId) => {
    setError(null);
    setParams({ step: s }, { replace: false });
  };

  // a step can be opened once every required step before it is complete
  const reachable = (s: StepId) =>
    STEPS.slice(0, stepIndex(s)).every(
      (x) => stepProblem(x.id, d, ctx) === null,
    );

  const persist = async () => {
    const body = toProfileIn(d);
    const key = JSON.stringify(body);
    if (key !== lastSaved.current) {
      await save.mutateAsync(body);
      lastSaved.current = key;
    }
    if (current === "answers") {
      for (const q of QUICK) {
        const a = drafts[q.field];
        const old = answers.data?.find((x) => x.field === q.field);
        if (
          a &&
          a.value.trim() &&
          (a.value.trim() !== old?.value || a.reusable !== old?.reusable)
        )
          await saveAnswer.mutateAsync({
            field: q.field,
            question: q.question,
            value: a.value.trim(),
            reusable: a.reusable,
          });
      }
    }
  };

  const next = async () => {
    setError(null);
    try {
      await persist();
      go(STEPS[Math.min(idx + 1, STEPS.length - 1)].id);
    } catch (e) {
      setError(e);
    }
  };
  const back = () => go(STEPS[Math.max(idx - 1, 0)].id);
  const saving = save.isPending || saveAnswer.isPending;
  const optional = current === "preferences" || current === "answers";
  const percent = Math.round((idx / (STEPS.length - 1)) * 100);

  return (
    <main className="mx-auto w-full max-w-[1280px] p-4 pb-32 sm:p-5 lg:px-6 lg:py-6 lg:pb-6">
      <div ref={top} />
      <header className="mb-6 space-y-1">
        <p className="text-sm text-muted">
          <Link to="/auto-apply" className="text-accent-dark hover:underline">
            Auto-Apply
          </Link>{" "}
          / Set up
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Set up Auto-Apply
        </h1>
      </header>
      {dash.data?.demo && (
        <div className="mb-4">
          <DemoNotice />
        </div>
      )}

      {/* progress on a phone: a bar and the step name */}
      <div className="mb-5 lg:hidden">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">
            Step {idx + 1} of {STEPS.length}
          </span>
          <span className="text-muted">{STEPS[idx].short}</span>
        </div>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-2 h-2 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${Math.max(percent, 6)}%` }}
          />
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-8">
        <nav aria-label="Setup steps" className="hidden lg:block">
          <ol className="sticky top-6 space-y-1">
            {STEPS.map((s, i) => {
              const isDone = done.has(s.id);
              const isCurrent = s.id === current;
              const can = isCurrent || reachable(s.id);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!can}
                    aria-current={isCurrent ? "step" : undefined}
                    onClick={() => go(s.id)}
                    className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors ${
                      isCurrent
                        ? "bg-surface font-medium shadow-card"
                        : can
                          ? "hover:bg-surface/70"
                          : "opacity-50"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
                        isDone
                          ? "bg-emerald-500 text-surface"
                          : isCurrent
                            ? "bg-accent text-surface"
                            : "bg-line text-muted"
                      }`}
                    >
                      {isDone ? "✓" : i + 1}
                    </span>
                    <span>
                      {s.short}
                      {isDone && <span className="sr-only"> (done)</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section
          key={current}
          aria-labelledby="step-h"
          className="animate-[slide-in_0.25s_ease-out] space-y-6 rounded-3xl bg-surface p-5 shadow-card sm:p-8"
        >
          <div id="step-h">
            <StepHeader
              n={idx + 1}
              title={STEPS[idx].title}
              intro={INTRO[current]}
            />
          </div>

          {current === "details" && <StepDetails />}
          {current === "role" && <StepRole d={d} set={set} />}
          {current === "preferences" && <StepPreferences d={d} set={set} />}
          {current === "schedule" && <StepSchedule d={d} set={set} />}
          {current === "apply" && <StepApply d={d} set={set} />}
          {current === "answers" && (
            <StepAnswers drafts={drafts} setDrafts={setDrafts} />
          )}
          {current === "review" && (
            <StepReview d={d} goTo={go} navigate={navigate} />
          )}

          <Fail error={error} />

          {current !== "review" && (
            <div className="fixed inset-x-0 bottom-0 z-20 bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lift backdrop-blur lg:static lg:bg-transparent lg:p-0 lg:shadow-none">
              <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:max-w-none">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={back}
                  disabled={idx === 0}
                >
                  Back
                </button>
                <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
                  {problem && (
                    <p
                      role="status"
                      className="hidden min-w-0 text-right text-sm text-muted sm:block"
                    >
                      {problem}
                    </p>
                  )}
                  {optional && (
                    <button
                      type="button"
                      className="tap px-2 text-sm text-muted hover:text-ink"
                      onClick={() => go(STEPS[idx + 1].id)}
                    >
                      Skip
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-primary btn-lg"
                    onClick={() => void next()}
                    disabled={!!problem || saving}
                  >
                    {saving ? "Saving…" : "Next"}
                  </button>
                </div>
              </div>
              {problem && (
                <p
                  role="status"
                  className="mt-2 text-center text-sm text-muted sm:hidden"
                >
                  {problem}
                </p>
              )}
            </div>
          )}
          {current === "review" && (
            <button type="button" className="btn-secondary" onClick={back}>
              Back
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
