import { type KeyboardEvent, useId, useState } from "react";

import { COUNTRIES } from "../data/countries";
import { ROLES } from "../data/roles";

/** Choose a country from the list. */
export function CountrySelect({
  id,
  label,
  value,
  onChange,
  regions = [],
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Wider areas to offer above the countries (Africa, Worldwide...). */
  regions?: string[];
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        className="input mt-1 w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="country-name"
      >
        <option value="">Select a country</option>
        {regions.length > 0 && (
          <optgroup label="Regions">
            {regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </optgroup>
        )}
        <optgroup label="Countries">
          {COUNTRIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

/** One role, from a dropdown of common titles. Anything else can still be typed. */
export function RoleInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const list = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className="input mt-1 w-full"
        list={list}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={120}
        placeholder={placeholder ?? "Start typing, or pick from the list"}
        autoComplete="off"
      />
      <datalist id={list}>
        {ROLES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Several values, picked from suggestions (or typed), shown as removable chips. */
export function MultiPick({
  id,
  label,
  values,
  onChange,
  suggestions,
  placeholder,
  addLabel = "Add",
  hint,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  addLabel?: string;
  hint?: string;
}) {
  const list = useId();
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase()))
      onChange([...values, v]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault(); // Enter adds; it does not submit the form
      add();
    }
  };
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`${label}: chosen`}>
          {values.map((v) => (
            <li
              key={v}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-accent-soft py-1 pl-3 pr-1 text-sm text-accent-dark"
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="tap flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent/15"
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          className="input min-w-0 flex-1"
          list={list}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder ?? "Start typing, or pick from the list"}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn-secondary shrink-0"
          onClick={add}
          disabled={!draft.trim()}
        >
          {addLabel}
        </button>
      </div>
      <datalist id={list}>
        {suggestions
          .filter((s) => !values.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
