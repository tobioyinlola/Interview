import { useState } from "react";

import { useEngagement } from "./api";
import {
  Badge,
  Bar,
  DaysSelect,
  Dynamics,
  Empty,
  Failed,
  Loading,
  PageHead,
  Panel,
  Stat,
  Table,
  Trend,
  duration,
  num,
  pct,
  when,
} from "./ui";

const PLATFORM: Record<string, string> = {
  web: "Website",
  windows: "Windows app",
  macos: "Mac app",
  linux: "Linux app",
  android: "Android app",
  ios: "iPhone app",
};
const FORM: Record<string, string> = {
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Computer",
};

/** How people use the app on every device: who is active, for how long, where, what they use and
 *  what breaks. It reads the app's own usage statistics, which hold counts and times, never words. */
export function EngagementPage() {
  const [days, setDays] = useState(30);
  const q = useEngagement(days);
  if (q.isPending) return <Loading what="engagement" />;
  if (q.isError) return <Failed what="engagement" />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHead
        title="Engagement"
        intro="How people use the app on every device: who is active, for how long, where, what they use and what breaks. Counts and times only. It never holds what anyone typed, said or uploaded."
        right={<DaysSelect days={days} onChange={setDays} />}
      />
      {!d.has_data ? (
        <Empty>
          Nothing recorded yet. Usage statistics start as soon as people use
          this version of the app, and stay off for anyone who turned them off
          in Settings.
        </Empty>
      ) : (
        <>
          <dl
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
            aria-label="Engagement numbers"
          >
            <Stat
              feature
              label="People active"
              value={num(d.people)}
              hint="signed in, in this window"
            >
              <Trend now={d.people} before={d.people_prev} onDark />
            </Stat>
            <Stat label="Visits" value={num(d.sessions)}>
              <Trend now={d.sessions} before={d.sessions_prev} />
            </Stat>
            <Stat
              label="A typical visit"
              value={duration(d.median_session_seconds)}
              hint={
                d.screens_per_session !== null
                  ? `${d.screens_per_session} screens each`
                  : undefined
              }
            />
            <Stat
              label="Time per person"
              value={
                d.engaged_minutes_per_person === null
                  ? "–"
                  : `${d.engaged_minutes_per_person} min`
              }
              hint="really there, not just open"
            />
            <Stat label="Active today" value={num(d.dau)} />
            <Stat label="Active this week" value={num(d.wau)} />
            <Stat
              label="Stickiness"
              value={pct(
                d.stickiness_pct === null ? null : Math.round(d.stickiness_pct),
              )}
              hint="today's actives as a share of the month's"
            />
            <Stat label="Devices seen" value={num(d.devices)} />
          </dl>

          <Panel
            id="dyn-h"
            title="Day by day"
            note="Pick a measure. Hover or touch a day to compare it with the average."
          >
            <Dynamics
              label="People, visits, devices and time per day"
              days={d.series.map((p) => p.day)}
              series={[
                {
                  name: "People",
                  values: d.series.map((p) => p.users),
                  color: "#7B47F3",
                },
                {
                  name: "Visits",
                  values: d.series.map((p) => p.sessions),
                  color: "#1C1B2E",
                },
                {
                  name: "Devices",
                  values: d.series.map((p) => p.devices),
                  color: "#16A34A",
                },
                {
                  name: "Minutes",
                  values: d.series.map((p) => p.engaged_minutes),
                  color: "#F59E0B",
                },
              ]}
            />
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              id="plat-h"
              title="Where people use it"
              note="Share of visits by app."
            >
              <ul className="space-y-4">
                {d.platforms.map((p) => (
                  <li key={p.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">
                        {PLATFORM[p.key] ?? p.key}
                      </span>
                      <span className="text-xs text-muted">
                        {num(p.devices)} devices · {num(p.sessions)} visits ·{" "}
                        {num(p.engaged_minutes)} min
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <Bar
                        value={p.share_pct}
                        label={`${PLATFORM[p.key] ?? p.key}: ${p.share_pct}% of visits`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel
              id="form-h"
              title="Phone, tablet or computer"
              note="By the screen the app was drawn on."
            >
              <ul className="space-y-4">
                {d.form_factors.map((p) => (
                  <li key={p.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">
                        {FORM[p.key] ?? p.key}
                      </span>
                      <span className="text-xs text-muted">
                        {num(p.devices)} devices · {num(p.sessions)} visits ·{" "}
                        {num(p.engaged_minutes)} min
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <Bar
                        value={p.share_pct}
                        label={`${FORM[p.key] ?? p.key}: ${p.share_pct}% of visits`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <section aria-labelledby="ret-h" className="space-y-3">
            <h2 id="ret-h" className="text-lg font-semibold tracking-tight">
              Do people come back?
            </h2>
            <p className="text-sm text-muted">
              Of the people who signed up at least that long ago, how many were
              active on that day after signing up.
            </p>
            <dl className="grid grid-cols-3 gap-3">
              {d.retention.map((r) => (
                <Stat
                  key={r.day}
                  label={`Day ${r.day}`}
                  value={r.pct === null ? "–" : `${r.pct}%`}
                  hint={
                    r.cohort
                      ? `${num(r.returned)} of ${num(r.cohort)} people`
                      : "too early to say"
                  }
                />
              ))}
            </dl>
          </section>

          <section aria-labelledby="scr-h" className="space-y-3">
            <h2 id="scr-h" className="text-lg font-semibold tracking-tight">
              Screens
            </h2>
            <Table
              label="Screens"
              head={["Screen", "Views", "People", "Time there"]}
            >
              {d.screens.map((s) => (
                <tr key={s.route}>
                  <td className="px-4 py-3 font-mono text-[13px]">{s.route}</td>
                  <td className="px-4 py-3 tabular-nums">{num(s.views)}</td>
                  <td className="px-4 py-3 tabular-nums">{num(s.people)}</td>
                  <td className="px-4 py-3 text-muted">
                    {duration(s.avg_seconds)}
                  </td>
                </tr>
              ))}
            </Table>
          </section>

          <section aria-labelledby="feat-h" className="space-y-3">
            <h2 id="feat-h" className="text-lg font-semibold tracking-tight">
              What people use
            </h2>
            {d.features.length === 0 ? (
              <Empty>No buttons or features used yet in this window.</Empty>
            ) : (
              <Table label="Features" head={["What", "Kind", "Uses", "People"]}>
                {d.features.map((f) => (
                  <tr key={`${f.kind}:${f.key}`}>
                    <td className="px-4 py-3 font-mono text-[13px]">{f.key}</td>
                    <td className="px-4 py-3">
                      <Badge tone={f.kind === "feature" ? "accent" : "default"}>
                        {f.kind === "feature" ? "Feature" : "Button"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{num(f.uses)}</td>
                    <td className="px-4 py-3 tabular-nums">{num(f.people)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          <section aria-labelledby="health-h" className="space-y-3">
            <h2 id="health-h" className="text-lg font-semibold tracking-tight">
              What goes wrong
            </h2>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="Visits with an error"
                value={pct(d.error_session_pct)}
                tone={(d.error_session_pct ?? 0) >= 2 ? "bad" : "default"}
              />
              <Stat
                label="Visits that went offline"
                value={pct(d.offline_session_pct)}
              />
              {d.load.map((l) => (
                <Stat
                  key={l.platform}
                  label={`Opens in · ${PLATFORM[l.platform] ?? l.platform}`}
                  value={`${(l.p50_ms / 1000).toFixed(1)} s`}
                  hint={`slowest 1 in 20: ${(l.p95_ms / 1000).toFixed(1)} s · ${num(l.samples)} opens`}
                />
              ))}
            </dl>
            {d.errors.length > 0 && (
              <Table
                label="Interface errors"
                head={["Error", "Screen", "Times", "Devices", "Last seen"]}
              >
                {d.errors.map((e) => (
                  <tr key={`${e.kind}:${e.route}`}>
                    <td className="px-4 py-3 font-mono text-[13px]">
                      {e.kind}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-muted">
                      {e.route ?? "–"}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{num(e.count)}</td>
                    <td className="px-4 py-3 tabular-nums">{num(e.devices)}</td>
                    <td className="px-4 py-3 text-muted">
                      {when(e.last_seen)}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          {d.versions.length > 0 && (
            <section aria-labelledby="ver-h" className="space-y-3">
              <h2 id="ver-h" className="text-lg font-semibold tracking-tight">
                App versions
              </h2>
              <Table label="App versions" head={["App", "Version", "Devices"]}>
                {d.versions.map((v) => (
                  <tr key={`${v.platform}:${v.app_version}`}>
                    <td className="px-4 py-3">
                      {PLATFORM[v.platform] ?? v.platform}
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px]">
                      {v.app_version}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{num(v.devices)}</td>
                  </tr>
                ))}
              </Table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
