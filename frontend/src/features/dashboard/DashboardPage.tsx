import { Link } from "react-router-dom";

import { currentEnv, isSupported } from "../../app/browserSupport";
import { useCompanies, useMe, useNotes, useSessions } from "../../api/hooks";
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
    <li className="flex items-start gap-2">
      <span aria-hidden="true">{ok ? (warn ? "!" : "✓") : "○"}</span>
      <span>
        <span className="sr-only">
          {ok ? (warn ? "Needs attention: " : "Done: ") : "Not done: "}
        </span>
        {children}
      </span>
    </li>
  );
}

/** What to do next: CV uploaded, a fresh brief, a browser that can share tab audio. */
function ReadinessCard() {
  const { data: me } = useMe();
  const agreed = me?.practice_consent === true;
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

  return (
    <section
      aria-labelledby="ready-h"
      className="space-y-3 rounded-2xl bg-surface p-5 shadow-card"
    >
      <h2 id="ready-h" className="text-lg font-medium">
        Readiness
      </h2>
      <ul className="space-y-1 text-sm">
        <Item ok={cvUploaded}>
          CV uploaded{" "}
          {!cvUploaded && (
            <Link to="/notes" className="text-accent-dark underline">
              Upload your CV
            </Link>
          )}
        </Item>
        <Item ok={hasBrief} warn={stale}>
          {hasBrief
            ? stale
              ? `Company brief is ${newest} days old. Consider researching again.`
              : "Company brief ready and fresh"
            : "Company brief (optional)"}{" "}
          {!hasBrief && (
            <Link to="/companies" className="text-accent-dark underline">
              Add a company
            </Link>
          )}
        </Item>
        <Item ok={canCapture}>Browser can share tab audio</Item>
        <Item ok={agreed}>
          {agreed
            ? "Partner consent: agreed (you can change this in Settings)"
            : "Partner consent: you confirm it when you start a session"}
        </Item>
      </ul>
      <Link
        to="/session/new"
        className={`inline-block rounded-xl px-4 py-2.5 font-medium ${ready ? "bg-accent text-surface hover:bg-accent-dark" : "border border-line"}`}
      >
        Start practice
      </Link>
    </section>
  );
}

/** Their chosen focus areas, and a line of advice that matches how soon the interview is. */
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

function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between text-sm text-muted">
        {label}
        <span className="rounded-lg bg-accent-soft p-1.5 text-accent-dark">
          {icon}
        </span>
      </div>
      <p className="mt-4 text-3xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function Action({
  to,
  title,
  sub,
  primary,
}: {
  to: string;
  title: string;
  sub: string;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-2xl p-3.5 transition-colors ${
        primary
          ? "bg-accent text-surface hover:bg-accent-dark"
          : "bg-canvas hover:bg-accent-soft"
      }`}
    >
      <span
        className={`rounded-xl p-2 ${primary ? "bg-surface/20" : "bg-surface text-accent-dark"}`}
      >
        {title.includes("practice") ? (
          <MicIcon />
        ) : title.includes("company") ? (
          <BuildingIcon />
        ) : (
          <NoteIcon />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span
          className={`block text-xs leading-snug ${primary ? "text-surface/80" : "text-muted"}`}
        >
          {sub}
        </span>
      </span>
      <ArrowIcon className="h-4 w-4 shrink-0" />
    </Link>
  );
}

const minutes = (s: number) =>
  s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`;

export function DashboardPage() {
  const { data: me } = useMe();
  const companies = useCompanies();
  const sessions = useSessions();
  const all = sessions.data?.pages.flatMap((p) => p.items) ?? [];
  const recent = (sessions.data?.pages[0]?.items ?? []).slice(0, 5);
  const more = sessions.hasNextPage ? "+" : "";
  const questions = all.reduce((n, s) => n + s.question_count, 0);
  const seconds = all.reduce((n, s) => n + (s.duration_seconds ?? 0), 0);
  const ready = (companies.data ?? []).filter(
    (c) => c.job_status === "ready",
  ).length;

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="min-w-0">
        <h1 className="sr-only">Dashboard</h1>
        <p className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">
          Hello
          {firstName(me?.full_name) ? `, ${firstName(me?.full_name)}` : ""}{" "}
          <span aria-hidden="true">👋</span>
        </p>
        <p className="mt-1 text-muted">Here&apos;s your practice overview.</p>
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <Stat
              label="Sessions"
              value={`${all.length}${more}`}
              hint="Practice calls"
              icon={<MicIcon className="h-4 w-4" />}
            />
            <Stat
              label="Questions"
              value={`${questions}${more}`}
              hint="Answered in practice"
              icon={<NoteIcon className="h-4 w-4" />}
            />
            <Stat
              label="Practice time"
              value={minutes(seconds)}
              hint={
                all.length
                  ? "Across your sessions"
                  : "Starts at your first call"
              }
              icon={<ClockIcon className="h-4 w-4" />}
            />
            <Stat
              label="Briefs ready"
              value={String(ready)}
              hint={`${companies.data?.length ?? 0} companies added`}
              icon={<BuildingIcon className="h-4 w-4" />}
            />
          </div>

          <ReadinessCard />

          <section
            aria-labelledby="chart-h"
            className="rounded-2xl bg-surface p-5 shadow-card"
          >
            <h2 id="chart-h" className="text-lg font-semibold">
              Practice summary
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
                className="text-sm text-accent-dark underline"
              >
                All companies
              </Link>
            </div>
            {companies.isSuccess && companies.data.length === 0 && (
              <p className="mt-3 text-muted">No companies yet.</p>
            )}
            <ul className="mt-3 divide-y divide-line">
              {(companies.data ?? []).slice(0, 5).map((c) => (
                <li key={c.id} className="flex justify-between gap-3 py-2.5">
                  <Link
                    to={`/companies/${c.id}`}
                    className="font-medium text-accent-dark underline"
                  >
                    {c.name}
                  </Link>
                  <span className="text-sm text-muted">
                    {c.job_status === "ready"
                      ? "Brief ready"
                      : c.job_status === "failed"
                        ? "Research failed"
                        : c.job_status
                          ? "Researching…"
                          : "Not researched"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-6">
          <FocusCard />

          <section
            aria-label="Quick actions"
            className="rounded-2xl bg-surface p-5 shadow-card"
          >
            <h2 className="text-lg font-semibold">Quick actions</h2>
            <div className="mt-3 space-y-2">
              <Action
                primary
                to="/session/new"
                title="New practice session"
                sub="Pick a company, then share your Meet tab"
              />
              <Action
                to="/companies"
                title="Add a company"
                sub="Research a role and get a cited brief"
              />
              <Action
                to="/notes"
                title="Upload your CV"
                sub="What outlines are built from"
              />
            </div>
          </section>

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
                className="text-sm text-accent-dark underline"
              >
                All sessions
              </Link>
            </div>
            {sessions.isSuccess && recent.length === 0 && (
              <p className="mt-3 text-muted">No sessions yet.</p>
            )}
            <ul className="mt-3 divide-y divide-line">
              {recent.map((s) => (
                <li key={s.id} className="py-2.5">
                  <Link
                    to={`/sessions/${s.id}`}
                    className="font-medium text-accent-dark underline"
                  >
                    {formatWhen(s.started_at)}
                  </Link>
                  <span className="mt-0.5 block text-sm text-muted">
                    {s.company_name ?? "No company"} ·{" "}
                    {formatDuration(s.duration_seconds)} · {s.question_count}{" "}
                    question{s.question_count === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
