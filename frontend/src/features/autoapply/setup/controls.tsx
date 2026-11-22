import type { ReactNode } from "react";

/** One choice out of a few, shown as a pill track. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex rounded-full bg-canvas p-1 ${className}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`min-h-[44px] rounded-full px-4 text-sm transition-all ${
              on
                ? "bg-surface font-medium text-ink shadow-card"
                : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Is this a must, or just nice to have? One clear choice instead of a tiny checkbox. */
export function Priority({
  label,
  required,
  onChange,
}: {
  label: string;
  required: boolean;
  onChange: (required: boolean) => void;
}) {
  return (
    <Segmented
      label={label}
      value={required ? "must" : "nice"}
      onChange={(v) => onChange(v === "must")}
      options={[
        { value: "must", label: "Must have" },
        { value: "nice", label: "Nice to have" },
      ]}
    />
  );
}

/** A round button for one of several options (seniority, contract type). */
export function Pill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-sm transition-all ${
        selected
          ? "bg-accent font-medium text-surface shadow-card"
          : "bg-canvas text-ink hover:bg-accent-soft"
      }`}
    >
      {selected && (
        <span aria-hidden="true" className="mr-1.5">
          ✓
        </span>
      )}
      {children}
    </button>
  );
}

/** A big card to switch an option on or off, with room for words under it. */
export function OptionTile({
  selected,
  onClick,
  icon,
  title,
  hint,
  children,
  stacked = false,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  hint: string;
  children?: ReactNode;
  /** Icon above the words, for tiles that sit side by side. */
  stacked?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-4 transition-all ${
        selected
          ? "bg-accent-soft shadow-lift"
          : "bg-canvas hover:bg-accent-soft/60"
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={`flex min-h-[56px] w-full gap-3 text-left ${
          stacked ? "h-full flex-col items-start" : "items-center"
        }`}
      >
        <span
          aria-hidden="true"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ${
            selected ? "bg-accent text-surface" : "bg-surface"
          }`}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block text-sm text-muted">{hint}</span>
        </span>
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${
            stacked ? "absolute right-3 top-3" : ""
          } ${selected ? "bg-accent text-surface" : "bg-line text-transparent"}`}
        >
          ✓
        </span>
      </button>
      {children && <div className="mt-3 pl-1">{children}</div>}
    </div>
  );
}

/** An on/off switch. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-[44px] items-center"
    >
      <span
        className={`flex h-7 w-12 items-center rounded-full p-1 transition-colors ${
          checked ? "bg-accent" : "bg-line-strong"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-surface shadow-card transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </span>
    </button>
  );
}

/** A labelled block inside a step. */
export function Block({
  title,
  hint,
  right,
  children,
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {hint && <p className="text-sm text-muted">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** The heading of a step: a big number, a title and one friendly sentence. */
export function StepHeader({
  n,
  title,
  intro,
}: {
  n: number;
  title: string;
  intro: string;
}) {
  return (
    <header className="flex items-start gap-4">
      <span
        aria-hidden="true"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-lg font-semibold text-surface shadow-card"
      >
        {n}
      </span>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-muted">{intro}</p>
      </div>
    </header>
  );
}
