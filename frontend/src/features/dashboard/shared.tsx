import {
  Briefcase,
  ChevronRight,
  ExternalLink,
  History,
  Mic,
  Rocket,
  Send,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useMe, useSessions } from "../../api/hooks";
import { GREETING_EMOJI, greeting } from "../account/greeting";
import { firstName } from "../account/names";
import { useDashboard } from "../autoapply/api";
import { Pill } from "../autoapply/ui";
import { formatWhen } from "../review/format";

/** "Good morning, Toby 😊" on one line, bold and a little big. The account circle (the person's
 *  initials) goes on the right, passed in by the caller. */
export function DashboardHeader({ right }: { right: ReactNode }) {
  const { data: me } = useMe();
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="min-w-0 truncate whitespace-nowrap text-2xl font-bold tracking-tight sm:text-3xl">
        {greeting()}, {firstName(me?.full_name) || "there"}{" "}
        <span aria-hidden="true">{GREETING_EMOJI}</span>
      </h1>
      {right}
    </div>
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
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-accent-dark shadow-card transition-transform hover:-translate-y-0.5">
          {icon}
        </span>
        <span className="text-xs font-medium sm:text-sm">{label}</span>
      </Link>
    </li>
  );
}

/** The four places people go most: job applications, interviews, their history, startup outreach. */
export function QuickActions() {
  const { data: me } = useMe();
  const items = [
    me?.autoapply && {
      to: "/auto-apply",
      label: "Auto-Apply",
      icon: <Rocket className="h-6 w-6" />,
    },
    {
      to: "/session/new",
      label: "Interview",
      icon: <Mic className="h-6 w-6" />,
    },
    {
      to: "/sessions",
      label: "History",
      icon: <History className="h-6 w-6" />,
    },
    me?.startup_outreach && {
      to: "/startups",
      label: "Startup",
      icon: <Send className="h-6 w-6" />,
    },
  ].filter(Boolean) as { to: string; label: string; icon: ReactNode }[];
  return (
    <section aria-label="Quick actions">
      <h2 className="mb-3 text-base font-semibold">Quick actions</h2>
      <ul
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {items.map((i) => (
          <Quick key={i.to} {...i} />
        ))}
      </ul>
    </section>
  );
}

type Row = {
  key: string;
  at: string;
  to: string;
  title: string;
  line: string;
  kind: "interview" | "application";
  status?: string;
  jobLink?: string | null;
};

const MAX_ROWS = 6;

/** The latest interviews and the latest applications, newest first, each with its link. */
export function RecentActivity() {
  const { data: me } = useMe();
  const sessions = useSessions();
  const apps = useDashboard(!!me?.autoapply);
  const rows: Row[] = [
    ...(sessions.data?.pages[0]?.items ?? []).map((s): Row => ({
      key: `i-${s.id}`,
      at: s.started_at,
      to: `/sessions/${s.id}`,
      title: s.company_name ?? "Interview",
      line: `Interview · ${formatWhen(s.started_at)}`,
      kind: "interview",
    })),
    ...(apps.data?.recent ?? []).map((a): Row => ({
      key: `a-${a.id}`,
      at: a.updated_at,
      to: `/auto-apply/applications/${a.id}`,
      title: a.posting.title,
      line: `${a.posting.company} · ${formatWhen(a.updated_at)}`,
      kind: "application",
      status: a.status,
      jobLink: a.posting.application_url,
    })),
  ]
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
    .slice(0, MAX_ROWS);
  const loading = sessions.isPending || (!!me?.autoapply && apps.isPending);

  return (
    <section aria-label="Recent">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Recent</h2>
        <Link
          to="/sessions"
          className="flex min-h-[44px] items-center text-sm font-medium text-accent-dark"
        >
          See all
        </Link>
      </div>
      <ul className="divide-y divide-canvas overflow-hidden rounded-[1.75rem] bg-surface shadow-card">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center">
            <Link
              to={r.to}
              className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 px-4 py-2"
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-dark"
              >
                {r.kind === "interview" ? (
                  <Mic className="h-5 w-5" />
                ) : (
                  <Briefcase className="h-5 w-5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.title}</span>
                <span className="block truncate text-sm text-muted">
                  {r.line}
                </span>
              </span>
              {r.status && <Pill status={r.status} />}
              <ChevronRight
                className="h-5 w-5 shrink-0 text-muted"
                aria-hidden="true"
              />
            </Link>
            {r.jobLink && (
              <a
                href={r.jobLink}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open the job: ${r.title}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-accent-dark"
              >
                <ExternalLink className="h-5 w-5" />
              </a>
            )}
          </li>
        ))}
        {!loading && rows.length === 0 && (
          <li className="p-5 text-center text-sm text-muted">
            Nothing yet. Interviews and applications show up here as you go.
          </li>
        )}
      </ul>
    </section>
  );
}
