import {
  Building2,
  ChevronRight,
  Gift,
  History,
  Mic,
  Rocket,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useCompanies, useMe, useNotes, useSessions } from "../../api/hooks";
import { GREETING_EMOJI, greeting } from "../account/greeting";
import { firstName } from "../account/names";
import { useDashboard } from "../autoapply/api";
import { ConnectGmail } from "../autoapply/ConnectGmail";
import { formatWhen } from "../review/format";
import { Avatar } from "./Avatar";

/** A small progress ring: how far through the 30 days. */
function Ring({ day, total }: { day: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={`Day ${day} of ${total}`}
      className="h-16 w-16 shrink-0 -rotate-90"
    >
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="7"
        className="stroke-accent-soft"
      />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(day, total) / total)}
        className="stroke-accent"
      />
    </svg>
  );
}

function Quick({
  to,
  icon,
  label,
}: {
  to: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex flex-col items-center gap-2 active:scale-95"
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-accent-dark shadow-card">
          {icon}
        </span>
        <span className="text-xs font-medium">{label}</span>
      </Link>
    </li>
  );
}

/** The phone app's home: one next step, one number that matters, a few shortcuts, a short list. */
export function PhoneHome() {
  const { data: me } = useMe();
  const notes = useNotes();
  const companies = useCompanies();
  const sessions = useSessions();
  const aaOn = !!me?.autoapply;
  const aa = useDashboard(aaOn);
  const cv = (notes.data?.content ?? "").trim().length > 0;
  const c = aa.data?.campaign;
  const running = c?.state === "active" || c?.state === "paused";
  const waiting = aa.data?.needs_input.length ?? 0;

  // the single most useful thing to do next
  const next =
    notes.isSuccess && !cv
      ? {
          to: "/settings/cv",
          title: "Add your CV",
          line: "So every answer sounds like you.",
        }
      : aaOn && aa.isSuccess && c?.state === "none"
        ? {
            to: "/auto-apply/setup",
            title: "Set up Auto-Apply",
            line: "A few questions, then 30 days of applications.",
          }
        : waiting > 0
          ? {
              to: "/auto-apply",
              title: `${waiting} waiting for you`,
              line: "A quick answer unlocks them.",
            }
          : running
            ? {
                to: "/auto-apply",
                title: "Auto-Apply is working",
                line: `Day ${c?.day} of ${c?.days_total}. Nothing needs you right now.`,
              }
            : companies.isSuccess && companies.data.length === 0
              ? {
                  to: "/companies",
                  title: "Add the company",
                  line: "Who is interviewing you?",
                }
              : {
                  to: "/companies",
                  title: "You're all set",
                  line: "Start a live interview and get draft answers.",
                };

  // job applications and startup pitches are one number
  const sent =
    (aa.data?.counts.submitted ?? 0) +
    (aa.data?.counts.sent_email ?? 0) +
    (aa.data?.startups?.sent ?? 0);
  const recent = aa.data?.recent.slice(0, 3) ?? [];
  const past = (sessions.data?.pages[0]?.items ?? []).slice(0, 3);

  return (
    <main className="space-y-6 px-5 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="sr-only">Home</h1>
      <div className="flex items-center justify-between">
        <Link
          to="/me"
          className="flex items-center gap-3"
          aria-label="Your profile"
        >
          <Avatar name={me?.full_name} email={me?.email} />
          <span>
            <span className="block text-sm text-muted">{greeting()},</span>
            <span className="block text-lg font-semibold leading-tight">
              {firstName(me?.full_name) || "there"}{" "}
              <span aria-hidden="true">{GREETING_EMOJI}</span>
            </span>
          </span>
        </Link>
      </div>

      <ConnectGmail />

      <Link
        to={next.to}
        aria-label={next.title}
        className="flex items-center gap-4 overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-ink via-ink to-accent-dark p-4 text-surface shadow-lift active:scale-[0.99]"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent">
          <Sparkles className="h-6 w-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-surface/70">Next step</span>
          <span className="block font-semibold">{next.title}</span>
          <span className="block text-sm text-surface/80">{next.line}</span>
        </span>
        <ChevronRight
          className="h-5 w-5 shrink-0 text-surface/70"
          aria-hidden="true"
        />
      </Link>

      {aaOn && (
        <Link
          to={c?.state === "none" ? "/auto-apply/setup" : "/auto-apply"}
          aria-label="Auto-Apply summary"
          className="flex items-center justify-between gap-4 rounded-[1.75rem] bg-surface p-5 shadow-card active:scale-[0.99]"
        >
          <span className="min-w-0">
            <span className="block text-sm text-muted">Applications sent</span>
            <span className="mt-1 block text-5xl font-semibold tabular-nums tracking-tight">
              {c?.state === "none" || !aa.data ? "–" : sent}
            </span>
            <span className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
              {aa.data && c?.state !== "none" ? (
                <>
                  <span className="rounded-full bg-accent-soft px-3 py-1.5 text-accent-dark">
                    {aa.data.usage
                      ? `${aa.data.usage.applications_used} of ${aa.data.usage.applications_cap} today`
                      : "Today"}
                  </span>
                  <span className="rounded-full bg-canvas px-3 py-1.5">
                    {waiting} waiting
                  </span>
                  <span className="rounded-full bg-canvas px-3 py-1.5">
                    {aa.data.open_invites.length +
                      (aa.data.next_interview ? 1 : 0)}{" "}
                    interviews
                  </span>
                </>
              ) : (
                <span className="rounded-full bg-accent-soft px-3 py-1.5 text-accent-dark">
                  Not started
                </span>
              )}
            </span>
          </span>
          {running && c?.day && c.days_total ? (
            <Ring day={c.day} total={c.days_total} />
          ) : (
            <Rocket
              className="h-10 w-10 shrink-0 text-accent"
              aria-hidden="true"
            />
          )}
        </Link>
      )}

      <section aria-label="Quick actions">
        <h2 className="mb-3 text-base font-semibold">Quick actions</h2>
        <ul className="grid grid-cols-4 gap-2">
          {aaOn ? (
            <Quick
              to="/auto-apply"
              icon={<Rocket className="h-6 w-6" />}
              label="Auto-Apply"
            />
          ) : (
            <Quick
              to="/referrals"
              icon={<Gift className="h-6 w-6" />}
              label="Invite"
            />
          )}
          <Quick
            to="/companies"
            icon={<Building2 className="h-6 w-6" />}
            label="Companies"
          />
          <Quick
            to="/session/new"
            icon={<Mic className="h-6 w-6" />}
            label="Interview"
          />
          <Quick
            to="/sessions"
            icon={<History className="h-6 w-6" />}
            label="History"
          />
        </ul>
      </section>

      <section aria-label="Recent">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Recent</h2>
          <Link
            to={recent.length ? "/auto-apply/applications" : "/sessions"}
            className="flex min-h-[44px] items-center text-sm font-medium text-accent-dark"
          >
            See all
          </Link>
        </div>
        <ul className="divide-y divide-canvas overflow-hidden rounded-[1.75rem] bg-surface shadow-card">
          {recent.map((a) => (
            <li key={a.id}>
              <Link
                to={`/auto-apply/applications/${a.id}`}
                className="flex min-h-[64px] items-center gap-3 px-4 py-2"
              >
                <Avatar name={a.posting.company} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {a.posting.title}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {a.posting.company}
                  </span>
                </span>
                <ChevronRight
                  className="h-5 w-5 text-muted"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
          {recent.length === 0 &&
            past.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/sessions/${s.id}`}
                  className="flex min-h-[64px] items-center gap-3 px-4 py-2"
                >
                  <Avatar name={s.company_name ?? "?"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {s.company_name ?? "Interview"}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {formatWhen(s.started_at)}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-5 w-5 text-muted"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          {recent.length === 0 && past.length === 0 && (
            <li className="p-5 text-center text-sm text-muted">
              Nothing yet. It shows up here as you go.
            </li>
          )}
        </ul>
      </section>
    </main>
  );
}
