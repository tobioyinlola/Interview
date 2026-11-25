import { useState } from "react";

import { useQuality } from "./api";
import {
  DaysSelect,
  Empty,
  Failed,
  Loading,
  PageHead,
  Stat,
  num,
  pct,
} from "./ui";

const sec = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`;

/** How good and how fast the product is: ratings, speed, scores, and how often jobs fail. */
export function QualityPage() {
  const [days, setDays] = useState(30);
  const q = useQuality(days);
  if (q.isPending) return <Loading what="quality" />;
  if (q.isError) return <Failed what="quality" />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHead
        title="Quality"
        intro="Do people find the answers useful, how fast do they arrive, and how often do the background jobs fail."
        right={<DaysSelect days={days} onChange={setDays} />}
      />
      <dl
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="Answer quality"
      >
        <Stat label="Answers written" value={num(d.answers)} />
        <Stat label="Rated" value={num(d.rated)} hint="thumbs up or down" />
        <Stat
          label="Found helpful"
          value={pct(d.helpful_pct)}
          hint="of the rated ones"
        />
        <Stat
          label="Flagged for a number"
          value={pct(d.flagged_pct)}
          hint="not in the CV, brief or question"
        />
      </dl>

      <section aria-labelledby="speed-h" className="space-y-2">
        <h2 id="speed-h" className="text-base font-semibold tracking-tight">
          Speed
        </h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="First words (typical)"
            value={sec(d.latency.p50_first_token_ms)}
          />
          <Stat
            label="First words (slow 1 in 20)"
            value={sec(d.latency.p95_first_token_ms)}
          />
          <Stat
            label="Full answer (typical)"
            value={sec(d.latency.p50_total_ms)}
          />
          <Stat
            label="Full answer (slow 1 in 20)"
            value={sec(d.latency.p95_total_ms)}
          />
        </dl>
      </section>

      <section aria-labelledby="fail-h" className="space-y-2">
        <h2 id="fail-h" className="text-base font-semibold tracking-tight">
          Background jobs
        </h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Company research runs" value={num(d.research_jobs)} />
          <Stat label="Research failed" value={pct(d.research_failed_pct)} />
          <Stat label="Scoring runs" value={num(d.scoring_runs)} />
          <Stat label="Scoring failed" value={pct(d.scoring_failed_pct)} />
        </dl>
      </section>

      <section aria-labelledby="mix-h" className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-2">
          <h2 id="mix-h" className="text-base font-semibold tracking-tight">
            What people are asked
          </h2>
          {Object.keys(d.by_type).length === 0 ? (
            <Empty>No answers yet.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {Object.entries(d.by_type)
                .sort((a, b) => b[1] - a[1])
                .map(([t, n]) => (
                  <li key={t} className="flex justify-between">
                    <span className="capitalize">{t}</span>
                    <span className="text-muted">{num(n)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <div className="card space-y-2">
          <h2 className="text-base font-semibold tracking-tight">
            How people score
          </h2>
          {Object.keys(d.avg_scores).length === 0 ? (
            <Empty>No scored interviews yet.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {Object.entries(d.avg_scores).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="capitalize">{k}</span>
                  <span className="text-muted">{v} / 100</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
