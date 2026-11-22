import { type ReactNode } from "react";

/** Small building blocks shared by the admin pages. */

export const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : n.toLocaleString();

export const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : `${n}%`;

export const duration = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined) return "–";
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

export const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "never";

/** "+12%" or "−5%" against the window before, or nothing when there was nothing before. */
export function Trend({ now, before }: { now: number; before: number }) {
  if (before === 0) return null;
  const change = Math.round(((now - before) / before) * 100);
  const up = change >= 0;
  return (
    <span
      className={`ml-2 text-xs font-medium ${up ? "text-green-700" : "text-red-700"}`}
    >
      {up ? "▲" : "▼"} {Math.abs(change)}%{" "}
      <span className="sr-only">compared with the period before</span>
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="card !p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">
        {value}
        {children}
      </dd>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function DaysSelect({
  days,
  onChange,
}: {
  days: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="text-sm">
      <span className="mr-2 text-muted">Window</span>
      <select
        value={days}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input !min-h-[40px] !py-1.5"
      >
        {[7, 30, 90].map((n) => (
          <option key={n} value={n}>
            Last {n} days
          </option>
        ))}
      </select>
    </label>
  );
}

export function PageHead({
  title,
  intro,
  right,
}: {
  title: string;
  intro?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {intro && <p className="mt-1 max-w-2xl text-sm text-muted">{intro}</p>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-canvas p-4 text-sm text-muted">{children}</p>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className="p-6 text-muted">
      Loading {what}…
    </p>
  );
}

export function Failed({ what }: { what: string }) {
  return (
    <p role="alert" className="notice-error">
      Couldn&apos;t load {what}. Reload to try again.
    </p>
  );
}

/** A table that scrolls sideways on a small screen instead of squeezing. */
export function Table({
  label,
  head,
  children,
}: {
  label: string;
  head: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
      <table
        className="w-full min-w-[560px] text-left text-sm"
        aria-label={label}
      >
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:nth-child(even)]:bg-canvas/70">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/** A horizontal bar whose width is a share of 100. */
export function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className="h-2.5 w-full overflow-hidden rounded-full bg-line"
    >
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/** A small line chart for one or two daily series, with the numbers behind it in a table. */
export function Trendline({
  label,
  days,
  series,
}: {
  label: string;
  days: string[];
  series: { name: string; values: number[]; color: string }[];
}) {
  const W = 600;
  const H = 150;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => 12 + (i * (W - 24)) / Math.max(1, days.length - 1);
  const y = (v: number) => 10 + (1 - v / max) * (H - 24);
  const summary = series
    .map((s) => `${s.name}: ${s.values.reduce((a, b) => a + b, 0)} in total`)
    .join("; ");
  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}. ${summary}`}
        className="h-40 w-full"
      >
        <line x1="12" x2={W - 12} y1={H - 14} y2={H - 14} stroke="#E6E1F5" />
        <line
          x1="12"
          x2={W - 12}
          y1={y(max / 2)}
          y2={y(max / 2)}
          stroke="#E6E1F5"
          strokeDasharray="4 4"
        />
        <text x="12" y="10" fontSize="10" fill="#5E5C75">
          {max}
        </text>
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeLinejoin="round"
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
          />
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-4 rounded"
              style={{ background: s.color }}
            />
            {s.name}
          </span>
        ))}
      </figcaption>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">Show the numbers</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table
            aria-label={`${label}, as a table`}
            className="w-full text-left"
          >
            <thead>
              <tr>
                <th scope="col">Day</th>
                {series.map((s) => (
                  <th key={s.name} scope="col">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d}>
                  <th scope="row" className="font-normal">
                    {d}
                  </th>
                  {series.map((s) => (
                    <td key={s.name}>{s.values[i]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
