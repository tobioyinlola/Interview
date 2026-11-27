import { trackStep } from "../../analytics";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useMe, useSaveOnboarding } from "../../api/hooks";
import { CheckIcon } from "../../app/icons";
import { Wordmark } from "../landing/Logo";
import {
  FOCUS,
  GOALS,
  LEVELS,
  MAX_FOCUS,
  PLAN,
  STEPS,
  TIMELINES,
  type Choice,
  type Focus,
  type Goal,
  type Level,
  type Timeline,
  entries,
  flowFor,
  ARRANGEMENTS,
  HELPS,
  SEARCHES,
  type Arrangement,
  type Help,
  type Search,
} from "./content";

const DONE = STEPS.length;

function Option({
  type,
  name,
  value,
  choice,
  checked,
  disabled,
  onChange,
}: {
  type: "radio" | "checkbox";
  name: string;
  value: string;
  choice: Choice;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`relative flex min-h-[64px] cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 shadow-card transition-all ${
        checked ? "bg-accent-soft shadow-lift" : "bg-surface hover:shadow-lift"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-canvas text-xl"
      >
        {choice.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{choice.label}</span>
        <span className="block text-sm text-muted">{choice.hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          checked ? "bg-accent text-surface" : "bg-line text-transparent"
        }`}
      >
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
      <span className="pointer-events-none absolute inset-0 rounded-2xl peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
    </label>
  );
}

/** What to do first, for what the person asked for. A CV helps all of it. */
function nextSteps(help: Help[]): [string, string, string][] {
  const all = help.length === 0; // skipped the question: the original three
  const out: [string, string, string][] = [
    [
      "/settings/cv",
      "Upload your CV",
      "Your stories and your applications come from it.",
    ],
  ];
  if (help.includes("auto_apply"))
    out.push([
      "/auto-apply/setup",
      "Set up Auto-Apply",
      "Tell it the roles you want. It finds jobs and prepares each application.",
    ]);
  if (help.includes("startups"))
    out.push([
      "/startups",
      "Reach out to startups",
      "Short, honest notes to founders and hiring contacts.",
    ]);
  if (all || help.includes("interviews"))
    out.push(
      [
        "/companies",
        "Add a company",
        "Get a brief where every fact cites a source.",
      ],
      [
        "/session/new",
        "Start an interview",
        "Share a Meet tab with a friend who knows.",
      ],
    );
  return out;
}

/** The short questions after sign-up. Everything can be skipped, and the answers can be changed
 *  later by coming back here. */
export function OnboardingPage() {
  const { data: me } = useMe();
  const save = useSaveOnboarding();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const needsName = useRef(!me?.full_name).current; // asked only if we do not have it yet

  const start = me?.onboarding;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(me?.full_name ?? "");
  const [goal, setGoal] = useState<Goal | null>(start?.goal ?? null);
  const [role, setRole] = useState("");
  const [level, setLevel] = useState<Level | null>(start?.level ?? null);
  const [timeline, setTimeline] = useState<Timeline | null>(
    start?.timeline ?? null,
  );
  const [focus, setFocus] = useState<Focus[]>(start?.focus ?? []);
  const [help, setHelp] = useState<Help[]>(start?.help ?? []);
  const [search, setSearch] = useState<Search | null>(start?.search ?? null);
  const [arrangement, setArrangement] = useState<Arrangement[]>(
    start?.arrangement ?? [],
  );
  // the job-search questions are asked only of someone who wants that kind of help
  const flow = flowFor(help);
  const pos = flow.indexOf(step);
  const wantsJobs = flow.length > 5;

  useEffect(() => heading.current?.focus(), [step]); // announce each new question
  useEffect(
    () => trackStep("onboarding", step === DONE ? "done" : `q${step + 1}`),
    [step],
  );

  const nameOk = !needsName || name.trim().length >= 2;
  const valid = [
    goal !== null && nameOk,
    level !== null,
    timeline !== null,
    focus.length > 0,
    help.length > 0,
    search !== null,
    arrangement.length > 0,
  ];
  const answers = {
    goal: goal ?? undefined,
    level: level ?? undefined,
    timeline: timeline ?? undefined,
    focus,
    help,
    search: wantsJobs ? (search ?? undefined) : undefined,
    arrangement: wantsJobs ? arrangement : [],
    role: role.trim() || undefined,
    full_name: needsName && name.trim() ? name.trim() : undefined,
  };

  const finish = () =>
    save.mutate(
      { ...answers, skipped: false },
      { onSuccess: () => setStep(DONE) },
    );
  const skip = () =>
    save.mutate(
      { ...answers, skipped: true },
      { onSuccess: () => navigate("/dashboard", { replace: true }) },
    );
  const toggle = <T,>(set: (fn: (cur: T[]) => T[]) => void, v: T) =>
    set((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const toggleFocus = (f: Focus) =>
    setFocus((cur) =>
      cur.includes(f)
        ? cur.filter((x) => x !== f)
        : cur.length < MAX_FOCUS
          ? [...cur, f]
          : cur,
    );

  const first = (me?.full_name ?? name).trim().split(" ")[0];
  // the interview plan is for someone who is practising; with the question skipped, assume they are
  const practising = help.length === 0 || help.includes("interviews");

  if (step === DONE) {
    return (
      <Frame>
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-[1.75rem] font-semibold leading-tight tracking-tight outline-none sm:text-3xl"
        >
          You&apos;re all set{first ? `, ${first}` : ""}{" "}
          <span aria-hidden="true">🎉</span>
        </h1>
        {timeline && practising && (
          <p className="mt-3 text-muted">{PLAN[timeline]}</p>
        )}
        {focus.length > 0 && practising && (
          <p className="mt-4 text-sm">
            <span className="text-muted">We&apos;ll keep in view: </span>
            {focus.map((f) => FOCUS[f].label).join(" · ")}
          </p>
        )}
        <ul className="mt-6 space-y-3">
          {nextSteps(help).map(([to, title, text], i) => (
            <li key={to}>
              <Link
                to={to}
                className="flex min-h-[64px] items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-card hover:bg-accent-soft"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-accent-dark">
                  {i + 1}
                </span>
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="block text-sm text-muted">{text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/dashboard" className="btn-primary btn-lg mt-6 w-full">
          Go to your dashboard
        </Link>
      </Frame>
    );
  }

  const info = STEPS[step];
  return (
    <Frame
      onSkip={skip}
      skipDisabled={save.isPending}
      progress={{ step: pos + 1, of: flow.length }}
    >
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-[1.75rem] font-semibold leading-tight tracking-tight outline-none sm:text-3xl"
      >
        {info.title}
      </h1>
      <p className="mt-2 text-sm text-muted">{info.why}</p>

      <div className="mt-6 space-y-3">
        {step === 0 && (
          <>
            {needsName && (
              <div className="mb-5">
                <label htmlFor="name" className="block text-sm font-medium">
                  What should we call you?
                </label>
                <input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={120}
                  placeholder="Your full name"
                  className="input mt-1 w-full"
                />
              </div>
            )}
            <fieldset className="space-y-3">
              <legend className="sr-only">{info.title}</legend>
              {entries(GOALS).map((o) => (
                <Option
                  key={o.value}
                  type="radio"
                  name="goal"
                  value={o.value}
                  choice={o}
                  checked={goal === o.value}
                  onChange={() => setGoal(o.value)}
                />
              ))}
            </fieldset>
          </>
        )}

        {step === 1 && (
          <>
            <div className="mb-5">
              <label htmlFor="role" className="block text-sm font-medium">
                What role are you aiming for?{" "}
                <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                maxLength={200}
                placeholder="e.g. Senior Product Manager"
                className="input mt-1 w-full"
              />
            </div>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-medium">
                How experienced are you?
              </legend>
              {entries(LEVELS).map((o) => (
                <Option
                  key={o.value}
                  type="radio"
                  name="level"
                  value={o.value}
                  choice={o}
                  checked={level === o.value}
                  onChange={() => setLevel(o.value)}
                />
              ))}
            </fieldset>
          </>
        )}

        {step === 2 && (
          <fieldset className="space-y-3">
            <legend className="sr-only">{info.title}</legend>
            {entries(TIMELINES).map((o) => (
              <Option
                key={o.value}
                type="radio"
                name="timeline"
                value={o.value}
                choice={o}
                checked={timeline === o.value}
                onChange={() => setTimeline(o.value)}
              />
            ))}
          </fieldset>
        )}

        {step === 3 && (
          <fieldset className="space-y-3">
            <legend className="sr-only">{info.title}</legend>
            {entries(FOCUS).map((o) => (
              <Option
                key={o.value}
                type="checkbox"
                name="focus"
                value={o.value}
                choice={o}
                checked={focus.includes(o.value)}
                disabled={!focus.includes(o.value) && focus.length >= MAX_FOCUS}
                onChange={() => toggleFocus(o.value)}
              />
            ))}
            <p aria-live="polite" className="text-sm text-muted">
              {focus.length} of {MAX_FOCUS} chosen
            </p>
          </fieldset>
        )}

        {step === 4 && (
          <fieldset className="space-y-3">
            <legend className="sr-only">{info.title}</legend>
            {entries(HELPS).map((o) => (
              <Option
                key={o.value}
                type="checkbox"
                name="help"
                value={o.value}
                choice={o}
                checked={help.includes(o.value)}
                onChange={() => toggle(setHelp, o.value)}
              />
            ))}
          </fieldset>
        )}

        {step === 5 && (
          <fieldset className="space-y-3">
            <legend className="sr-only">{info.title}</legend>
            {entries(SEARCHES).map((o) => (
              <Option
                key={o.value}
                type="radio"
                name="search"
                value={o.value}
                choice={o}
                checked={search === o.value}
                onChange={() => setSearch(o.value)}
              />
            ))}
          </fieldset>
        )}

        {step === 6 && (
          <fieldset className="space-y-3">
            <legend className="sr-only">{info.title}</legend>
            {entries(ARRANGEMENTS).map((o) => (
              <Option
                key={o.value}
                type="checkbox"
                name="arrangement"
                value={o.value}
                choice={o}
                checked={arrangement.includes(o.value)}
                onChange={() => toggle(setArrangement, o.value)}
              />
            ))}
          </fieldset>
        )}
      </div>

      {save.isError && (
        <p role="alert" className="notice-error mt-4">
          {save.error.message}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        {pos > 0 && (
          <button
            type="button"
            onClick={() => setStep(flow[pos - 1]!)}
            disabled={save.isPending}
            className="btn-secondary btn-lg"
          >
            Back
          </button>
        )}
        {pos < flow.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep(flow[pos + 1]!)}
            disabled={!valid[step]}
            className="btn-primary btn-lg flex-1"
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            onClick={finish}
            disabled={!valid[step] || save.isPending}
            className="btn-primary btn-lg flex-1"
          >
            {save.isPending ? "Saving…" : "Finish"}
          </button>
        )}
      </div>
    </Frame>
  );
}

function Frame({
  children,
  onSkip,
  skipDisabled,
  progress,
}: {
  children: React.ReactNode;
  onSkip?: () => void;
  skipDisabled?: boolean;
  progress?: { step: number; of: number };
}) {
  return (
    <div className="min-h-screen bg-canvas text-ink [min-height:100dvh]">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <div className="mx-auto flex max-w-xl items-center justify-between py-2">
          <Wordmark />
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={skipDisabled}
              className="inline-flex min-h-[44px] items-center text-sm text-muted hover:text-ink disabled:opacity-50"
            >
              Skip for now
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-8">
        {progress && (
          <div className="mb-6">
            <p className="text-sm font-medium text-muted">
              Step {progress.step} of {progress.of}
            </p>
            <div
              role="progressbar"
              aria-label="Onboarding progress"
              aria-valuemin={1}
              aria-valuemax={progress.of}
              aria-valuenow={progress.step}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
            >
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${(progress.step / progress.of) * 100}%` }}
              />
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
