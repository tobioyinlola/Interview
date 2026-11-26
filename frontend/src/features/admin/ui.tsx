import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { SearchIcon } from "../../app/icons";

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

/** A change against the window before as a small chip: "↑ 12%" or "↓ 5%". Nothing when there was
 *  nothing before. On the highlighted card it reads on the purple. */
export function Trend({
  now,
  before,
  onDark = false,
}: {
  now: number;
  before: number;
  onDark?: boolean;
}) {
  if (before === 0) return null;
  const change = Math.round(((now - before) / before) * 100);
  const up = change >= 0;
  const tone = onDark
    ? "bg-surface/20 text-surface"
    : up
      ? "bg-emerald-50 text-emerald-700"
      : "bg-red-50 text-red-700";
  return (
    <span
      className={`ml-2 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold ${tone}`}
    >
      <span aria-hidden="true">{up ? "↑" : "↓"}</span>
      {Math.abs(change)}%
      <span className="sr-only">
        {up ? " up" : " down"} compared with the period before
      </span>
    </span>
  );
}

const REGION_NAMES: Record<string, string> = {
  us: "United States",
  eu: "Europe",
  uk: "United Kingdom",
  uae: "UAE",
  ksa: "Saudi Arabia",
  mena: "MENA",
  other: "Elsewhere",
};
/** A region label as people say it. */
export const regionName = (r: string) => REGION_NAMES[r] ?? r;

type Tone = "default" | "good" | "warn" | "bad" | "accent";

const TONE_CHIP: Record<Tone, string> = {
  default: "bg-panel text-muted",
  good: "bg-emerald-50 text-emerald-800",
  warn: "bg-amber-50 text-amber-900",
  bad: "bg-red-50 text-red-800",
  accent: "bg-accent-soft text-accent-dark",
};

const DOT: Record<Tone, string> = {
  default: "bg-muted/60",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  accent: "bg-accent",
};

/** A small status pill. */
export function Badge({
  tone = "default",
  dot = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean; // a coloured dot before the words, for a status
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${TONE_CHIP[tone]}`}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`}
        />
      )}
      {children}
    </span>
  );
}

/** Initials in a soft circle: a face for a row when there is no photo. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const parts = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const text = (
    (parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts[1]?.[0] ?? "") : "")
  ).toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-dark"
    >
      {text}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  children,
  to,
  tone = "default",
  icon,
  feature = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  children?: ReactNode;
  to?: string; // makes the number a link to the list it counts
  tone?: Tone;
  icon?: ReactNode;
  feature?: boolean; // the one card to look at first: purple, lifted
}) {
  const alarm = tone === "bad" || tone === "warn";
  const bg = feature
    ? "bg-gradient-to-br from-accent to-[#5B2FD0] text-surface shadow-lift"
    : alarm
      ? tone === "bad"
        ? "bg-red-50 shadow-card"
        : "bg-amber-50 shadow-card"
      : "bg-surface shadow-card hover:shadow-lift";
  return (
    <div className={`rounded-3xl p-5 transition-shadow ${bg}`}>
      <div className="flex items-start justify-between gap-2">
        <dt
          className={`text-[13px] font-medium ${feature ? "text-surface/80" : "text-muted"}`}
        >
          {label}
        </dt>
        {icon && (
          <span
            aria-hidden="true"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              feature
                ? "bg-surface/20 text-surface"
                : TONE_CHIP[tone === "default" ? "accent" : tone]
            }`}
          >
            {icon}
          </span>
        )}
      </div>
      <dd className="mt-3 text-[32px] font-semibold leading-none tracking-tight tabular-nums">
        {to ? (
          <Link
            to={to}
            className="hover:underline"
            aria-label={`${label}: ${value}, see the list`}
          >
            {value}
          </Link>
        ) : (
          value
        )}
        {children}
      </dd>
      {hint && (
        <p
          className={`mt-3 text-xs ${feature ? "text-surface/75" : "text-muted"}`}
        >
          {hint}
        </p>
      )}
      {to && (
        <Link
          to={to}
          className={`mt-2 inline-block text-xs font-medium hover:underline ${feature ? "text-surface" : "text-accent-dark"}`}
        >
          See the list
        </Link>
      )}
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
    <label className="inline-flex items-center gap-2 rounded-full bg-surface px-4 text-sm shadow-card">
      <span className="text-muted">Window</span>
      <select
        value={days}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-[40px] cursor-pointer bg-transparent py-1.5 pr-1 font-medium focus:outline-none"
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
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pt-1">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight sm:text-[34px]">
          {title}
        </h1>
        {intro && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            {intro}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

/** A titled block of the page: heading, a line of explanation, an action on the right. */
export function Panel({
  id,
  title,
  note,
  action,
  children,
  flush = false,
}: {
  id?: string;
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean; // content runs to the card's edges (tables, lists)
}) {
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-3xl bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pb-1 pt-6">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {note && <p className="mt-0.5 text-sm text-muted">{note}</p>}
        </div>
        {action}
      </div>
      <div className={flush ? "pt-3" : "space-y-4 p-6 pt-3"}>{children}</div>
    </section>
  );
}

/** The search box every list uses: icon inside, one clear action. */
export function SearchField({
  id,
  value,
  onChange,
  placeholder,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative min-w-0 flex-1 sm:flex-none">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
        <SearchIcon className="h-4 w-4" />
      </span>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input w-full !min-h-[44px] !rounded-full !bg-surface !pl-10 shadow-card sm:w-80"
      />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl bg-surface px-6 py-12 text-center shadow-card">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-dark"
      >
        <SearchIcon className="h-5 w-5" />
      </span>
      <p className="max-w-sm text-sm text-muted">{children}</p>
    </div>
  );
}

/** A grey placeholder shape while data arrives, so the page does not jump. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl bg-line/70 ${className}`}
    />
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">Loading {what}…</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-56" />
    </div>
  );
}

export function Failed({ what }: { what: string }) {
  return (
    <p role="alert" className="notice-error">
      Couldn&apos;t load {what}. Reload to try again.
    </p>
  );
}

/** Previous / next, with where you are. */
export function Pager({
  from,
  to,
  total,
  onPrev,
  onNext,
}: {
  from: number;
  to: number;
  total: number;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}) {
  return (
    <div className="flex items-center justify-between text-sm text-muted">
      <span aria-live="polite">
        {from}–{to} of {num(total)}
      </span>
      <span className="flex gap-2">
        <button
          className="btn-secondary btn-sm"
          disabled={!onPrev}
          onClick={() => onPrev?.()}
        >
          Previous
        </button>
        <button
          className="btn-secondary btn-sm"
          disabled={!onNext}
          onClick={() => onNext?.()}
        >
          Next
        </button>
      </span>
    </div>
  );
}

/** A table. On a phone each row turns into a small card with its column names beside the values,
 *  so nothing scrolls sideways and nothing is cut off. */
export function Table({
  label,
  head,
  children,
}: {
  label: string;
  head: string[];
  children: ReactNode;
}) {
  const body = useRef<HTMLTableSectionElement>(null);
  useLayoutEffect(() => {
    body.current?.querySelectorAll("tr").forEach((row) => {
      Array.from(row.children).forEach((cell, i) => {
        if (head[i]) (cell as HTMLElement).dataset.label = head[i];
      });
    });
  });
  return (
    <div className="adm-table overflow-hidden rounded-3xl bg-surface shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" aria-label={label}>
          <thead className="bg-panel/70 text-xs text-muted">
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="px-5 py-3.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            ref={body}
            className="[&>tr>td]:py-4 [&>tr>td:first-child]:px-5 [&>tr]:transition-colors [&>tr:hover]:bg-panel/60"
          >
            {children}
          </tbody>
        </table>
      </div>
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
      className="h-2 w-full overflow-hidden rounded-full bg-panel"
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-dark transition-[width] duration-500"
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
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor={series[0]?.color ?? "#7B47F3"}
              stopOpacity="0.22"
            />
            <stop
              offset="100%"
              stopColor={series[0]?.color ?? "#7B47F3"}
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        {series[0] && days.length > 1 && (
          <polygon
            fill="url(#trend-fill)"
            points={`${x(0)},${H - 14} ${series[0].values
              .map((v, i) => `${x(i)},${y(v)}`)
              .join(" ")} ${x(days.length - 1)},${H - 14}`}
          />
        )}
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.color}
            strokeWidth="2.25"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
          />
        ))}
        {days.length > 1 && (
          <>
            <text x="12" y={H - 1} fontSize="10" fill="#5E5C75">
              {days[0]}
            </text>
            <text
              x={W - 12}
              y={H - 1}
              fontSize="10"
              textAnchor="end"
              fill="#5E5C75"
            >
              {days[days.length - 1]}
            </text>
          </>
        )}
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

/** Pill filters with a count: "All 34 · Public 15 · Private 9". One is always chosen. */
export function Tabs<T extends string>({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; count?: number }[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap gap-1 rounded-full bg-panel p-1"
    >
      {items.map((i) => {
        const on = i.id === value;
        return (
          <button
            key={i.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(i.id)}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors ${
              on
                ? "bg-surface font-medium text-ink shadow-card"
                : "text-muted hover:text-ink"
            }`}
          >
            {i.label}
            {i.count !== undefined && (
              <span
                className={`text-xs tabular-nums ${on ? "text-accent-dark" : "text-muted/80"}`}
              >
                {num(i.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const niceMax = (v: number) => {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow / 2) * pow * 2 > v * 1.6
    ? Math.ceil(v / (pow / 2)) * (pow / 2)
    : Math.ceil(v / pow) * pow;
};

/** Daily bars for one measure at a time, chosen with pill tabs. Hover or touch a bar for the day and
 *  how it compares with the period's average. The numbers behind it stay in a table for anyone who
 *  cannot use the picture. */
export function Dynamics({
  label,
  days,
  series,
}: {
  label: string;
  days: string[];
  series: { name: string; values: number[]; color: string }[];
}) {
  const [pick, setPick] = useState(0);
  const [at, setAt] = useState<number | null>(null);
  const cur = series[pick] ?? series[0];
  if (!cur) return null;
  const top = niceMax(Math.max(1, ...cur.values));
  const avg = cur.values.reduce((a, b) => a + b, 0) / Math.max(1, days.length);
  const summary = series
    .map((x) => `${x.name}: ${x.values.reduce((a, b) => a + b, 0)} in total`)
    .join("; ");
  const hit =
    at === null ? null : { day: days[at] ?? "", v: cur.values[at] ?? 0 };
  const vs = hit && avg > 0 ? Math.round(((hit.v - avg) / avg) * 100) : null;
  const left = at === null ? 0 : ((at + 0.5) / Math.max(1, days.length)) * 100;
  return (
    <figure className="space-y-4">
      <Tabs
        label="Measure"
        value={cur.name}
        onChange={(n) =>
          setPick(
            Math.max(
              0,
              series.findIndex((x) => x.name === n),
            ),
          )
        }
        items={series.map((x) => ({ id: x.name, label: x.name }))}
      />
      <div
        role="img"
        aria-label={`${label}. ${summary}`}
        className="relative h-56 pl-9 pt-2"
        onMouseLeave={() => setAt(null)}
      >
        <div className="absolute inset-x-0 bottom-7 left-9 top-2">
          {[top, top / 2, 0].map((g) => (
            <div
              key={g}
              aria-hidden="true"
              className="absolute inset-x-0"
              style={{ bottom: `${(g / top) * 100}%` }}
            >
              <span className="absolute right-full top-0 mr-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted">
                {num(Math.round(g))}
              </span>
              <span className="block h-px bg-ink/[0.06]" />
            </div>
          ))}
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {cur.values.map((v, i) => (
              <div
                key={days[i] ?? i}
                className="flex h-full flex-1 items-end"
                onMouseEnter={() => setAt(i)}
                onPointerDown={() => setAt(i)}
              >
                <div
                  className={`w-full rounded-t-md transition-colors ${
                    at === i
                      ? "bg-accent"
                      : i === cur.values.length - 1
                        ? "bg-accent/60"
                        : "bg-accent/20"
                  }`}
                  style={{ height: `${Math.max(1.5, (v / top) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="absolute bottom-0 left-9 right-0 flex justify-between text-[10px] text-muted">
          <span>{days[0]}</span>
          <span>{days[days.length - 1]}</span>
        </div>
        {hit && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-2xl bg-surface p-3 text-xs shadow-lift"
            style={{
              left: `calc(2.25rem + (100% - 2.25rem) * ${Math.min(0.85, Math.max(0.15, left / 100))})`,
            }}
          >
            <p className="font-semibold">{hit.day}</p>
            <p className="mt-1.5 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-muted">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: cur.color }}
                />
                {cur.name}
              </span>
              <span className="font-semibold tabular-nums">{num(hit.v)}</span>
            </p>
            {vs !== null && (
              <p
                className={`mt-2 inline-flex rounded-full px-2 py-0.5 font-medium ${
                  vs >= 0
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                {vs >= 0 ? "↑" : "↓"} {Math.abs(vs)}% vs the average
              </p>
            )}
          </div>
        )}
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Show the numbers</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table
            aria-label={`${label}, as a table`}
            className="w-full text-left"
          >
            <thead>
              <tr>
                <th scope="col">Day</th>
                {series.map((x) => (
                  <th key={x.name} scope="col">
                    {x.name}
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
                  {series.map((x) => (
                    <td key={x.name}>{x.values[i]}</td>
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
