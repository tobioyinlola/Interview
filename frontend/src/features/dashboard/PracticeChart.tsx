import type { SessionSummary } from "../../api/types";

const W = 600;
const H = 200;
const PAD = { l: 32, r: 12, t: 12, b: 28 };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

/** Questions asked per session, oldest to newest. Drawn from the user's own sessions; with fewer
 *  than two there is no trend to draw, so it says so instead of inventing one. */
export function PracticeChart({ sessions }: { sessions: SessionSummary[] }) {
  const points = [...sessions].reverse().slice(-12);
  if (points.length < 2) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong bg-canvas px-4 py-6 text-center text-sm text-muted">
        Your practice history will appear here after two sessions.
      </p>
    );
  }
  const max = Math.max(4, ...points.map((s) => s.question_count));
  const x = (i: number) =>
    PAD.l + (i * (W - PAD.l - PAD.r)) / (points.length - 1);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = points
    .map((s, i) => `${i ? "L" : "M"}${x(i)},${y(s.question_count)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1)},${H - PAD.b} L${x(0)},${H - PAD.b} Z`;
  const summary = points
    .map((s) => `${day(s.started_at)}: ${s.question_count}`)
    .join("; ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Questions per session. ${summary}`}
      className="h-52 w-full"
    >
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(max * t)}
            y2={y(max * t)}
            stroke="#E6E1F5"
            strokeDasharray="4 4"
          />
          <text
            x={PAD.l - 6}
            y={y(max * t) + 4}
            textAnchor="end"
            fontSize="10"
            fill="#5E5C75"
          >
            {Math.round(max * t)}
          </text>
        </g>
      ))}
      <path d={area} fill="#7B47F3" opacity="0.1" />
      <path
        d={line}
        fill="none"
        stroke="#7B47F3"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {points.map((s, i) => (
        <g key={s.id}>
          <circle
            cx={x(i)}
            cy={y(s.question_count)}
            r="4"
            fill="#FFFFFF"
            stroke="#7B47F3"
            strokeWidth="2"
          >
            <title>{`${day(s.started_at)}: ${s.question_count} questions`}</title>
          </circle>
          {(i === 0 || i === points.length - 1 || points.length <= 6) && (
            <text
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#5E5C75"
            >
              {day(s.started_at)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
