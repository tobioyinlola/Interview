import { type FormEvent, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { currentEnv, isSupported } from "../../app/browserSupport";
import { isDesktopApp } from "../../app/desktop";
import { isMobileApp } from "../../app/native";
import {
  useBilling,
  useCompanies,
  useCreateCompany,
  useMe,
  useNotes,
  useSessions,
} from "../../api/hooks";
import {
  ArrowIcon,
  BuildingIcon,
  ClockIcon,
  MicIcon,
  NoteIcon,
} from "../../app/icons";
import { FOCUS, PLAN } from "../onboarding/content";
export { firstName } from "../account/names";
import { firstName } from "../account/names";
import { PracticeChart } from "./PracticeChart";
import { daysSince } from "../companies/ResearchStatus";
import { formatDuration, formatWhen } from "../review/format";

const STALE_DAYS = 7;

function Item({
  ok,
  warn,
  children,
}: {
  ok: boolean;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          ok
            ? warn
              ? "bg-amber-100 text-amber-700"
              : "bg-emerald-100 text-emerald-700"
            : "bg-canvas text-muted"
        }`}
      >
        {ok ? (warn ? "!" : "✓") : ""}
      </span>
      <span className="pt-0.5">
        <span className="sr-only">
          {ok ? (warn ? "Needs attention: " : "Done: ") : "Not done: "}
        </span>
        {children}
      </span>
    </li>
  );
}

/** What to do next: CV uploaded, a fresh brief, a browser that can share tab audio. */
/** The checklist is about starting a live interview, which a phone cannot do. */
function ReadinessCard() {
  return isMobileApp() ? null : <ReadinessChecklist />;
}

function ReadinessChecklist() {
  const notes = useNotes();
  const companies = useCompanies();
  const cvUploaded = (notes.data?.content ?? "").trim().length > 0;
  const researched = (companies.data ?? []).filter(
    (c) => c.job_status === "ready" && c.last_researched_at,
  );
  const newest = researched
    .map((c) => daysSince(c.last_researched_at) ?? 0)
    .sort((a, b) => a - b)[0];
  const hasBrief = researched.length > 0;
  const stale = hasBrief && newest > STALE_DAYS;
  const canCapture = isSupported(currentEnv());
  const ready = cvUploaded && canCapture;
  const done = [cvUploaded, hasBrief && !stale, canCapture].filter(
    Boolean,
  ).length;

  return (
    <section
      aria-labelledby="ready-h"
      className="space-y-3 rounded-2xl bg-surface p-5 shadow-card"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ready-h" className="text-lg font-semibold">
          Readiness
        </h2>
        <span className="text-sm text-muted">{done} of 3 ready</span>
      </div>
      <div
        role="progressbar"
        aria-label="Interview readiness"
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={done}
        className="h-2 overflow-hidden rounded-full bg-canvas"
      >
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${(done / 3) * 100}%` }}
        />
      </div>
      <ul className="space-y-3 text-sm">
        <Item ok={cvUploaded}>
          CV uploaded{" "}
          {!cvUploaded && (
            <Link to="/settings/cv" className="text-accent-dark underline">
              Upload your CV
            </Link>
          )}
        </Item>
        <Item ok={hasBrief} warn={stale}>
          {hasBrief
            ? stale
              ? `Company brief is ${newest} days old. Consider researching again.`
              : "Company brief ready and fresh"
            : "The company interviewing you"}{" "}
          {!hasBrief && (
            <Link to="/companies" className="text-accent-dark underline">
              Add a company
            </Link>
          )}
        </Item>
        <Item ok={canCapture}>
          {isDesktopApp()
            ? "App can listen to your computer's audio"
            : "Browser can share tab audio"}
        </Item>
      </ul>
      <Link
        to="/session/new"
        className={`inline-block rounded-xl px-4 py-2.5 font-medium ${ready ? "bg-accent text-surface hover:bg-accent-dark" : "bg-accent-soft text-accent-dark"}`}
      >
        Start interview
      </Link>
    </section>
  );
}

/** Their chosen focus areas, and a line of advice that matches how soon the interview is. */
/** Shown until a company has been added: who is interviewing you? Researches them straight away
 *  (what they do and how), so the dashboard is useful from the first minute. */
function InterviewTargetCard() {
  const notes = useNotes();
  const create = useCreateCompany();
  const navigate = useNavigate();
  const key = useRef(crypto.randomUUID());
  const [name, setName] = useState("");
  const [site, setSite] = useState("");
  const [role, setRole] = useState<string | null>(null); // null: follow the role from the CV page
  const shownRole = role ?? notes.data?.role ?? "";
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
          role: shownRole.trim(),
          known_text: "",
        },
      },
      {
        onSuccess: (r) => navigate(`/companies/${r.company.id}`),
        onError: () => {
          key.current = crypto.randomUUID();
        },
      },
    );
  };
  const field = "input mt-1 w-full";
  return (
    <section
      aria-labelledby="target-h"
      className="space-y-3 rounded-2xl bg-surface p-5 shadow-lift"
    >
      <div>
        <h2 id="target-h" className="text-lg font-semibold">
          Who is interviewing you?
        </h2>
        <p className="mt-1 text-sm text-muted">
          Tell us the company you are interviewing with, not an employer you
          have worked for. We research what they do and how they work, so every
          answer fits them.
        </p>
      </div>
      <form
        onSubmit={submit}
        className="space-y-3"
        aria-label="Interview target"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="t-name" className="block text-sm font-medium">
              Company interviewing you
            </label>
            <input
              id="t-name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="t-role" className="block text-sm font-medium">
              Role you&apos;re interviewing for
            </label>
            <input
              id="t-role"
              maxLength={200}
              value={shownRole}
              onChange={(e) => setRole(e.target.value)}
              className={field}
            />
          </div>
        </div>
        <div>
          <label htmlFor="t-site" className="block text-sm font-medium">
            Company website{" "}
            <span className="font-normal text-muted">(recommended)</span>
          </label>
          <input
            id="t-site"
            type="url"
            placeholder="https://"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            className={field}
          />
        </div>
        {create.isError && (
          <p role="alert" className="notice-error">
            {create.error.message}
          </p>
        )}
        <button
          type="submit"
          className="btn-primary"
          disabled={!name.trim() || create.isPending}
        >
          {create.isPending ? "Starting…" : "Research this company"}
        </button>
      </form>
    </section>
  );
}

/** The free sessions left, and how far along the invite reward is. */
function SessionsCard() {
  const billing = useBilling();
  const b = billing.data;
  if (!b) return null;
  const done = b.referrals_qualified % b.referrals_per_reward;
  return (
    <section
      aria-labelledby="sessions-left-h"
      className="space-y-3 rounded-2xl bg-surface p-5 shadow-card"
    >
      <div className="flex items-baseline justify-between">
        <h2 id="sessions-left-h" className="text-lg font-semibold">
          Your sessions
        </h2>
        <Link to="/referrals" className="text-sm text-accent-dark underline">
          Invite friends
        </Link>
      </div>
      <p>
        <span className="text-3xl font-semibold">{b.sessions_available}</span>{" "}
        <span className="text-muted">
          {b.sessions_available === 1 ? "session" : "sessions"} available
        </span>
      </p>
      {b.sessions_available === 0 && (
        <p className="text-sm text-muted">
          More sessions will be pay per session. Payments are coming soon.
        </p>
      )}
      {b.rewards_redeemable > 0 ? (
        <Link to="/referrals" className="btn-primary w-full">
          Redeem your free session
        </Link>
      ) : (
        <p className="text-sm text-muted">
          {done} of {b.referrals_per_reward} friends invited toward a free
          session.
        </p>
      )}
    </section>
  );
}

function FocusCard() {
  const { data: me } = useMe();
  const o = me?.onboarding;
  if (!o || !(o.focus?.length || o.timeline)) return null;
  return (
    <section
      aria-labelledby="focus-h"
      className="rounded-2xl bg-surface p-5 shadow-card"
    >
      <div className="flex items-baseline justify-between">
        <h2 id="focus-h" className="text-lg font-semibold">
          Your focus
        </h2>
        <Link to="/onboarding" className="text-sm text-accent-dark underline">
          Update
        </Link>
      </div>
      {o.focus && o.focus.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {o.focus.map((f) => (
            <li
              key={f}
              className="rounded-full bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-dark"
            >
              <span aria-hidden="true">{FOCUS[f].emoji}</span> {FOCUS[f].label}
            </li>
          ))}
        </ul>
      )}
      {o.timeline && (
        <p className="mt-3 text-sm text-muted">{PLAN[o.timeline]}</p>
      )}
    </section>
  );
}

const TONES = {
  violet: "bg-accent-soft text-accent-dark",
  sky: "bg-sky-100 text-sky-700",
  amber: "bg-amber-100 text-amber-700",
  emerald: "bg-emerald-100 text-emerald-700",
};

function Stat({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone: keyof typeof TONES;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card transition-transform hover:-translate-y-0.5 sm:p-5">
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-xl ${TONES[tone]}`}
      >
        {icon}
      </span>
      <p className="mt-4 text-3xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      <p className="mt-0.5 text-sm font-medium">{label}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

/** A round letter for a company, so lists are easy to scan. */
function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft font-semibold text-accent-dark"
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

const BRIEF: Record<string, { text: string; tone: string }> = {
  ready: { text: "Brief ready", tone: "bg-emerald-100 text-emerald-700" },
  failed: { text: "Research failed", tone: "bg-red-100 text-red-700" },
};

/** The one thing to do next, as a big friendly card at the top. */
function Hero({
  name,
  cv,
  companies,
  sessions,
}: {
  name: string;
  cv: boolean;
  companies: number;
  sessions: number;
}) {
  const next = !cv
    ? {
        to: "/settings/cv",
        cta: "Add your CV",
        line: "Start with your CV so every answer sounds like you.",
      }
    : companies === 0
      ? {
          to: "/companies",
          cta: "Add the company",
          line: "Tell us who is interviewing you and we will research them.",
        }
      : isMobileApp()
        ? {
            to: "/auto-apply",
            cta: "Open Auto-Apply",
            line: "Review what we found and approve applications. Live interviews run on your computer.",
          }
        : {
            to: "/session/new",
            cta: "New interview",
            line:
              sessions === 0
                ? "You are all set. Start your first interview when you are ready."
                : "Pick a company and share your Meet tab to get live help.",
          };
  return (
    <section
      aria-label="What to do next"
      className="overflow-hidden rounded-3xl bg-gradient-to-br from-ink via-ink to-accent-dark p-6 text-surface shadow-lift sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="sr-only">Dashboard</h1>
          <p className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">
            Hello{name ? `, ${name}` : ""} <span aria-hidden="true">👋</span>
          </p>
          <p className="mt-1 text-surface/80">
            Here&apos;s your interview overview.
          </p>
          <ol
            aria-label="Getting started"
            className="mt-4 flex flex-wrap gap-2 text-xs font-medium"
          >
            {[
              ["CV", cv],
              ["Company", companies > 0],
              ["First interview", sessions > 0],
            ].map(([label, done]) => (
              <li
                key={String(label)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
                  done ? "bg-emerald-400/20 text-emerald-200" : "bg-surface/10"
                }`}
              >
                <span aria-hidden="true">{done ? "✓" : "○"}</span>
                {label}
                <span className="sr-only">{done ? " done" : " to do"}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 max-w-md text-lg text-surface/90">{next.line}</p>
          <Link
            to={next.to}
            className="btn btn-lg mt-5 bg-surface text-ink hover:bg-canvas"
          >
            {next.cta}
            <ArrowIcon className="h-4 w-4" />
          </Link>
        </div>
        <div
          aria-hidden="true"
          className="hidden h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-surface/10 sm:flex"
        >
          <MicIcon className="h-12 w-12" />
        </div>
      </div>
    </section>
  );
}

/** A nudge toward the other half of the product. */
function AutoApplyCard() {
  return (
    <Link
      to="/auto-apply"
      className="group block rounded-2xl bg-accent-soft p-5 transition-colors hover:bg-accent-soft/70"
    >
      <span className="text-sm font-medium text-accent-dark">New</span>
      <h2 className="mt-1 text-lg font-semibold">Let Auto-Apply find jobs</h2>
      <p className="mt-1 text-sm text-muted">
        Answer a few questions once and we apply to jobs that fit you for 30
        days. You approve anything uncertain.
      </p>
      <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-dark">
        Set it up{" "}
        <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

const minutes = (s: number) =>
  s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`;

export function DashboardPage() {
  const { data: me } = useMe();
  const companies = useCompanies();
  const sessions = useSessions();
  const notes = useNotes();
  const all = sessions.data?.pages.flatMap((p) => p.items) ?? [];
  const recent = (sessions.data?.pages[0]?.items ?? []).slice(0, 5);
  const more = sessions.hasNextPage ? "+" : "";
  const questions = all.reduce((n, s) => n + s.question_count, 0);
  const seconds = all.reduce((n, s) => n + (s.duration_seconds ?? 0), 0);
  const ready = (companies.data ?? []).filter(
    (c) => c.job_status === "ready",
  ).length;

  return (
    <main className="max-w-6xl space-y-5 p-4 sm:p-5 lg:px-5 lg:py-6">
      <Hero
        name={firstName(me?.full_name)}
        cv={notes.data ? notes.data.content.trim().length > 0 : true}
        companies={companies.data?.length ?? 1}
        sessions={all.length}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 2xl:grid-cols-4">
            <Stat
              label="Sessions"
              value={`${all.length}${more}`}
              hint="Interviews"
              tone="violet"
              icon={<MicIcon className="h-4 w-4" />}
            />
            <Stat
              label="Questions"
              value={`${questions}${more}`}
              hint="Questions answered"
              tone="sky"
              icon={<NoteIcon className="h-4 w-4" />}
            />
            <Stat
              label="Interview time"
              value={minutes(seconds)}
              hint={
                all.length
                  ? "Across your sessions"
                  : "Starts at your first call"
              }
              tone="amber"
              icon={<ClockIcon className="h-4 w-4" />}
            />
            <Stat
              label="Briefs ready"
              value={String(ready)}
              hint={`${companies.data?.length ?? 0} companies added`}
              tone="emerald"
              icon={<BuildingIcon className="h-4 w-4" />}
            />
          </div>

          {companies.isSuccess && companies.data.length === 0 && (
            <InterviewTargetCard />
          )}

          <ReadinessCard />

          <section
            aria-labelledby="chart-h"
            className="rounded-2xl bg-surface p-5 shadow-card"
          >
            <h2 id="chart-h" className="text-lg font-semibold">
              Interview summary
            </h2>
            <p className="text-sm text-muted">
              Questions per session, most recent sessions.
            </p>
            <div className="mt-4">
              <PracticeChart sessions={all} />
            </div>
          </section>

          <section
            aria-labelledby="co-h"
            className="rounded-2xl bg-surface p-5 shadow-card"
          >
            <div className="flex items-baseline justify-between">
              <h2 id="co-h" className="text-lg font-semibold">
                Companies
              </h2>
              <Link
                to="/companies"
                className="text-sm font-medium text-accent-dark hover:underline"
              >
                All companies
              </Link>
            </div>
            {companies.isSuccess && companies.data.length === 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas p-4">
                <p className="text-muted">No companies yet.</p>
                <Link to="/companies" className="btn-primary">
                  Add a company
                </Link>
              </div>
            )}
            <ul className="mt-3 space-y-1">
              {(companies.data ?? []).slice(0, 5).map((c) => {
                const b = c.job_status ? BRIEF[c.job_status] : undefined;
                return (
                  <li key={c.id}>
                    <Link
                      to={`/companies/${c.id}`}
                      className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-canvas"
                    >
                      <Avatar name={c.name} />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {c.name}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${b?.tone ?? "bg-canvas text-muted"}`}
                      >
                        {c.job_status === "ready"
                          ? "Brief ready"
                          : c.job_status === "failed"
                            ? "Research failed"
                            : c.job_status
                              ? "Researching…"
                              : "Not researched"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="space-y-5">
          <SessionsCard />
          <AutoApplyCard />
          <FocusCard />

          <section
            aria-labelledby="se-h"
            className="rounded-2xl bg-surface p-5 shadow-card"
          >
            <div className="flex items-baseline justify-between">
              <h2 id="se-h" className="text-lg font-semibold">
                Recent sessions
              </h2>
              <Link
                to="/sessions"
                className="text-sm font-medium text-accent-dark hover:underline"
              >
                All sessions
              </Link>
            </div>
            {sessions.isSuccess && recent.length === 0 && (
              <div className="mt-3 rounded-2xl bg-canvas p-4">
                <p className="text-muted">No sessions yet.</p>
                <Link
                  to="/session/new"
                  className="mt-1 inline-block text-sm font-medium text-accent-dark hover:underline"
                >
                  Start your first interview
                </Link>
              </div>
            )}
            <ul className="mt-3 space-y-1">
              {recent.map((s) => (
                <li key={s.id} className="flex items-center gap-3 p-2">
                  <Avatar name={s.company_name ?? "?"} />
                  <div className="min-w-0">
                    <Link
                      to={`/sessions/${s.id}`}
                      className="font-medium text-accent-dark hover:underline"
                    >
                      {formatWhen(s.started_at)}
                    </Link>
                    <span className="mt-0.5 block text-sm text-muted">
                      {s.company_name ?? "No company"} ·{" "}
                      {formatDuration(s.duration_seconds)} · {s.question_count}{" "}
                      question{s.question_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
