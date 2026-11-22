import { useState } from "react";

import { useAdminUsage } from "../../api/hooks";

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : `$${n.toFixed(n < 1 ? 3 : 2)}`;

/** The owner's cost view: spend per day, the heaviest users, average cost of a session and of a
 *  research job, and the caps in force. Estimates only; the provider's billing is the truth. */
export function UsagePage() {
  const [days, setDays] = useState(30);
  const q = useAdminUsage(days);

  if (q.isPending) return <p className="p-8">Loading…</p>;
  if (q.isError) return <p className="p-8">This page isn&apos;t available.</p>;
  const d = q.data;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-end justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">
          Usage and cost
        </h1>
        <label className="text-sm">
          Window{" "}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="input"
          >
            {[7, 30, 90].map((n) => (
              <option key={n} value={n}>
                Last {n} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-sm text-muted">
        Estimates from counted audio seconds and tokens at the configured
        prices. Check the provider&apos;s own billing for the real figure.
      </p>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Totals">
        {[
          ["Estimated total", usd(d.total_cost_usd)],
          ["Sessions", String(d.sessions)],
          ["Avg per session", usd(d.avg_cost_per_session_usd)],
          ["Avg per research job", usd(d.avg_cost_per_research_job_usd)],
        ].map(([k, v]) => (
          <div key={k} className="card !p-4">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="text-xl font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="days-h" className="space-y-2">
        <h2 id="days-h" className="text-lg font-semibold">
          By day
        </h2>
        {d.days.length === 0 ? (
          <p className="text-muted">No usage in this window.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="py-1">Day</th>
                <th>Sessions</th>
                <th>Users</th>
                <th>Audio (min)</th>
                <th>Tokens in / out</th>
                <th>Research jobs</th>
                <th className="text-right">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {d.days.map((r) => (
                <tr key={r.day}>
                  <td className="py-1">{r.day}</td>
                  <td>{r.sessions}</td>
                  <td>{r.active_users}</td>
                  <td>{(r.stt_seconds / 60).toFixed(1)}</td>
                  <td>
                    {r.llm_input_tokens.toLocaleString()} /{" "}
                    {r.llm_output_tokens.toLocaleString()}
                  </td>
                  <td>{r.research_jobs}</td>
                  <td className="text-right">{usd(r.estimated_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="top-h" className="space-y-2">
        <h2 id="top-h" className="text-lg font-semibold">
          Heaviest users
        </h2>
        <ol className="list-card">
          {d.top_users.map((u) => (
            <li key={u.email} className="flex justify-between p-2 text-sm">
              <span>{u.email}</span>
              <span className="text-muted">
                {(u.stt_seconds / 60).toFixed(1)} min ·{" "}
                {u.tokens.toLocaleString()} tokens · {u.research_jobs} research
                · <strong>{usd(u.estimated_cost_usd)}</strong>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="caps-h" className="space-y-1 text-sm">
        <h2 id="caps-h" className="text-lg font-semibold">
          Caps in force (per user, per day)
        </h2>
        <p>
          Transcription {Math.round(d.caps.stt_seconds_daily / 60)} min · Tokens{" "}
          {d.caps.tokens_daily.toLocaleString()} · Research jobs{" "}
          {d.caps.research_jobs_daily}
        </p>
        <p className="text-muted">
          Prices: ${d.prices.stt_per_minute}/min audio · $
          {d.prices.llm_input_per_million}/M input tokens · $
          {d.prices.llm_output_per_million}/M output tokens
        </p>
      </section>
    </main>
  );
}
