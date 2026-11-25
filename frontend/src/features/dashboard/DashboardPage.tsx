import { Link } from "react-router-dom";

import { currentEnv, isSupported } from "../../app/browserSupport";
import { isDesktopApp } from "../../app/desktop";
import { isMobileApp } from "../../app/native";
import { useBilling, useMe, useNotes, useSessions } from "../../api/hooks";
import { ArrowIcon, ClockIcon, MicIcon, NoteIcon } from "../../app/icons";
import { ProfileMenu } from "../../app/ProfileMenu";
import { FOCUS, PLAN } from "../onboarding/content";
export { firstName } from "../account/names";
import { ConnectGmail } from "../autoapply/ConnectGmail";
import { PracticeChart } from "./PracticeChart";
import { DashboardHeader, QuickActions, RecentActivity } from "./shared";

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
  const cvUploaded = (notes.data?.content ?? "").trim().length > 0;
  const canCapture = isSupported(currentEnv());
  const done = [cvUploaded, canCapture].filter(Boolean).length;

  return (
    <section
      aria-labelledby="ready-h"
      className="space-y-3 rounded-2xl bg-surface p-5 shadow-card"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ready-h" className="text-lg font-semibold">
          Readiness
        </h2>
        <span className="text-sm text-muted">{done} of 2 ready</span>
      </div>
      <div
        role="progressbar"
        aria-label="Interview readiness"
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={done}
        className="h-2 overflow-hidden rounded-full bg-canvas"
      >
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${(done / 2) * 100}%` }}
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
        <Item ok={canCapture}>
          {isDesktopApp()
            ? "App can listen to your computer's audio"
            : "Browser can share tab audio"}
        </Item>
      </ul>
      <Link
        to="/session/new"
        className={`inline-block rounded-xl px-4 py-2.5 font-medium ${cvUploaded && canCapture ? "bg-accent text-surface hover:bg-accent-dark" : "bg-accent-soft text-accent-dark"}`}
      >
        Start interview
      </Link>
    </section>
  );
}

/** Their chosen focus areas, and a line of advice that matches how soon the interview is. */
/** The free sessions left, and how far along the invite reward is. */
function SessionsCard() {
  const billing = useBilling();
  const b = billing.data;
  if (!b || b.sessions_free) return null; // free while testing: nothing to count, no invite prompt
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

/** The one thing to do next, as a big friendly card at the top. */
function Hero({ cv, sessions }: { cv: boolean; sessions: number }) {
  const next = !cv
    ? {
        to: "/settings/cv",
        cta: "Add your CV",
        line: "Start with your CV so every answer sounds like you.",
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
          <p className="text-sm text-surface/70">Next step</p>
          <p className="mt-1 max-w-md text-xl font-semibold">{next.line}</p>
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
        We find jobs that fit you and apply for 30 days. You approve anything
        uncertain.
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
  const sessions = useSessions();
  const notes = useNotes();
  const all = sessions.data?.pages.flatMap((p) => p.items) ?? [];
  const more = sessions.hasNextPage ? "+" : "";
  const questions = all.reduce((n, s) => n + s.question_count, 0);
  const seconds = all.reduce((n, s) => n + (s.duration_seconds ?? 0), 0);
  // Someone who has not had a session yet sees one clear path (CV, first interview), not a page of
  // empty boxes. Everything else appears once there is something to show.
  const fresh = sessions.isSuccess && all.length === 0;
  const hasCv = notes.data ? notes.data.content.trim().length > 0 : false;

  return (
    <main className="page-wide">
      <h1 className="sr-only">Dashboard</h1>
      <DashboardHeader right={<ProfileMenu />} />

      <Hero
        cv={notes.data ? notes.data.content.trim().length > 0 : true}
        sessions={all.length}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <QuickActions />

          {hasCv && <ConnectGmail />}

          {!fresh && (
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
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
            </div>
          )}

          <ReadinessCard />

          {!fresh && (
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
          )}
        </div>

        <div className="space-y-5">
          <RecentActivity />
          <SessionsCard />
          <AutoApplyCard />
          <FocusCard />
        </div>
      </div>
    </main>
  );
}
