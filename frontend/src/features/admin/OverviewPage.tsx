import { useState } from "react";
import { Link } from "react-router-dom";

import { ClockIcon, MicIcon, PlusIcon, UsersIcon } from "../../app/icons";
import { useOverview } from "./api";
import {
  Bar,
  DaysSelect,
  Failed,
  Loading,
  PageHead,
  Panel,
  Stat,
  Trend,
  Trendline,
  duration,
  num,
  pct,
} from "./ui";

/** Product health at a glance: growth, activity, the activation funnel, and what is going wrong. */
export function OverviewPage() {
  const [days, setDays] = useState(30);
  const q = useOverview(days);
  if (q.isPending) return <Loading what="the overview" />;
  if (q.isError) return <Failed what="the overview" />;
  const d = q.data;
  const h = d.health;
  const problems = [
    ["Research jobs failed", h.research_failed_24h, "last 24 hours"],
    ["Scoring runs failed", h.scoring_failed_24h, "last 24 hours"],
    ["Emails not delivered", h.emails_failed_24h, "last 24 hours"],
    ["Wrong passwords", h.wrong_passwords_24h, "last 24 hours"],
    ["Blocked: no interviews left", h.blocked_no_credit_7d, "last 7 days"],
  ] as const;
  const worrying = problems.slice(0, 3).some(([, n]) => n > 0);

  return (
    <div className="space-y-6">
      <PageHead
        title="Overview"
        intro="Who is arriving, who is active, how far people get, and what is going wrong."
        right={<DaysSelect days={days} onChange={setDays} />}
      />

      {worrying && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900"
        >
          <span>
            <strong className="font-semibold">
              Something failed recently.
            </strong>{" "}
            See who was affected in the{" "}
            <Link to="/admin/activity?category=email" className="underline">
              activity log
            </Link>{" "}
            or the{" "}
            <Link to="/admin/emails" className="underline">
              email log
            </Link>
            .
          </span>
        </div>
      )}

      <dl
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label="Key numbers"
      >
        <Stat
          label="People"
          value={num(d.total_users)}
          hint="all accounts"
          icon={<UsersIcon className="h-4 w-4" />}
        />
        <Stat
          label={`New in ${days} days`}
          value={num(d.new_users)}
          icon={<PlusIcon className="h-4 w-4" />}
        >
          <Trend now={d.new_users} before={d.new_users_prev} />
        </Stat>
        <Stat
          label={`Interviews in ${days} days`}
          value={num(d.sessions)}
          icon={<MicIcon className="h-4 w-4" />}
        >
          <Trend now={d.sessions} before={d.sessions_prev} />
        </Stat>
        <Stat
          label="Average interview"
          value={duration(d.avg_session_seconds)}
          icon={<ClockIcon className="h-4 w-4" />}
          hint={
            d.avg_questions_per_session !== null
              ? `${d.avg_questions_per_session} answers each`
              : undefined
          }
        />
        <Stat
          label="Active today"
          value={num(d.dau)}
          hint="signed in or ran an interview"
        />
        <Stat label="Active this week" value={num(d.wau)} />
        <Stat label="Active this month" value={num(d.mau)} />
        <Stat
          label="Stickiness"
          value={pct(d.mau ? Math.round((100 * d.wau) / d.mau) : null)}
          hint="weekly actives as a share of monthly"
        />
      </dl>

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <Panel
            id="trend-h"
            title="Day by day"
            note="Sign-ups, interviews and active people."
          >
            <Trendline
              label="Sign-ups, interviews and active people per day"
              days={d.series.map((p) => p.day)}
              series={[
                {
                  name: "Sign-ups",
                  values: d.series.map((p) => p.signups),
                  color: "#7B47F3",
                },
                {
                  name: "Interviews",
                  values: d.series.map((p) => p.sessions),
                  color: "#1C1B2E",
                },
                {
                  name: "Active people",
                  values: d.series.map((p) => p.active_users),
                  color: "#16A34A",
                },
              ]}
            />
          </Panel>
        </div>
        <div className="xl:col-span-2">
          <Panel
            id="funnel-h"
            title="Activation funnel"
            note={`The ${num(d.new_users)} people who signed up in the last ${days} days, and how far they got.`}
          >
            <ol className="space-y-4">
              {d.funnel.map((s) => (
                <li key={s.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-right text-xs text-muted">
                      {num(s.users)} · {pct(s.of_signups_pct)} of sign-ups
                      {s.from_previous_pct !== null && (
                        <> · {pct(s.from_previous_pct)} of the step before</>
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Bar
                      value={s.of_signups_pct}
                      label={`${s.label}: ${s.of_signups_pct}% of sign-ups`}
                    />
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>

      <section aria-labelledby="health-h" className="space-y-3">
        <h2 id="health-h" className="text-base font-semibold tracking-tight">
          What needs attention
        </h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {problems.map(([label, n, span]) => (
            <Stat
              key={label}
              label={label}
              value={num(n)}
              hint={span}
              tone={n > 0 ? "bad" : "default"}
            />
          ))}
        </dl>
      </section>

      <section
        aria-labelledby="inv-h"
        className="rounded-2xl bg-accent-soft p-5"
      >
        <h2 id="inv-h" className="text-base font-semibold tracking-tight">
          Invites
        </h2>
        <p className="mt-1 text-sm text-ink/80">
          {num(d.referrals_counted)} sign-ups counted, {num(d.referrals_held)}{" "}
          held for looking like the inviter&apos;s own device,{" "}
          {num(d.rewards_redeemed)} free interviews redeemed.{" "}
          <Link
            to="/admin/referrals"
            className="font-medium text-accent-dark underline"
          >
            See invites
          </Link>
        </p>
      </section>
    </div>
  );
}
