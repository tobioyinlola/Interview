import { Link } from "react-router-dom";

import { useFunnel, useResumeSending } from "./api";

const BAND: Record<string, string> = {
  best: "Best fits",
  good: "Good fits",
  low: "Loose fits",
};
const VERSION: Record<string, string> = {
  written: "Written for each startup",
  template: "Your own emails",
};
const pct = (n: number, of: number) =>
  of > 0 ? `${Math.round((100 * n) / of)}%` : "–";

/** How outreach is going: the path from a startup with an address to a reply, what works best, the
 *  limit for today, and a clear stop (with a way back) when sending paused itself. */
export function Results() {
  const q = useFunnel();
  const resume = useResumeSending();
  const f = q.data;
  if (!f) return null;
  return (
    <section className="card space-y-4" aria-label="How it is going">
      {f.paused_reason && (
        <div
          role="alert"
          className="space-y-2 rounded-2xl bg-red-50 p-4 text-red-950"
        >
          <p className="font-medium">Sending stopped by itself</p>
          <p className="text-sm">{f.paused_reason}</p>
          <button
            type="button"
            className="btn-primary"
            disabled={resume.isPending}
            onClick={() => resume.mutate()}
          >
            Turn sending back on
          </button>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          How it is going
        </h2>
        <p className="text-sm text-muted">
          Today: {f.sent_today} of {f.daily_limit}. The limit starts low and
          rises over your first three weeks, and drops back if emails bounce.
        </p>
      </div>

      <ol
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        aria-label="From startup to reply"
      >
        {[
          ["With an address", f.with_contact],
          ["Written", f.written],
          ["Sent", f.sent],
          ["Replied", f.replied],
        ].map(([label, n]) => (
          <li key={label} className="rounded-2xl bg-canvas p-3">
            <span className="block text-2xl font-semibold">{n}</span>
            <span className="text-xs text-muted">{label}</span>
          </li>
        ))}
      </ol>

      <p className="text-sm">
        <span className="font-medium">{f.positive}</span> interested,{" "}
        <span className="font-medium">{f.negative}</span> not hiring,{" "}
        <span className="font-medium">{f.asked_to_stop}</span> asked you to
        stop, <span className="font-medium">{f.bounced}</span> bounced
        {f.follow_ups_sent > 0 && `, ${f.follow_ups_sent} follow-ups sent`}.
        {f.waiting_review > 0 &&
          ` ${f.waiting_review} waiting for your review.`}
      </p>
      {f.positive > 0 && (
        <p className="text-sm">
          Someone is interested.{" "}
          <Link to="/session/new" className="text-accent-dark underline">
            Practice for the interview
          </Link>
        </p>
      )}

      {f.sent > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <table
            className="w-full text-left text-sm"
            aria-label="Replies by fit"
          >
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-2">By fit</th>
                <th className="py-1 pr-2">Sent</th>
                <th className="py-1">Replied</th>
              </tr>
            </thead>
            <tbody>
              {f.by_fit.map((b) => (
                <tr key={b.band} className="border-t border-line">
                  <td className="py-1 pr-2">{BAND[b.band]}</td>
                  <td className="py-1 pr-2">{b.sent}</td>
                  <td className="py-1">
                    {b.replied} ({pct(b.replied, b.sent)})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table
            className="w-full text-left text-sm"
            aria-label="Replies by email"
          >
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-2">By email</th>
                <th className="py-1 pr-2">Sent</th>
                <th className="py-1">Replied</th>
              </tr>
            </thead>
            <tbody>
              {f.by_version
                .filter((v) => v.sent > 0)
                .map((v) => (
                  <tr key={v.version} className="border-t border-line">
                    <td className="py-1 pr-2">{VERSION[v.version]}</td>
                    <td className="py-1 pr-2">{v.sent}</td>
                    <td className="py-1">
                      {v.replied} ({pct(v.replied, v.sent)})
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
