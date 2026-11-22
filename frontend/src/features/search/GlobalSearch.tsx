import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCompanies, useSessions } from "../../api/hooks";
import { type Result, search } from "./search";

const GROUPS = ["Pages", "Companies", "Sessions"] as const;

/** The search box in the dashboard's top bar. It looks through the pages, the person's companies and
 *  their sessions; everything it needs is already loaded for the dashboard, so it answers as you
 *  type. Press / anywhere to jump to it. */
export function GlobalSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const companies = useCompanies();
  const sessions = useSessions();

  const results = useMemo(
    () =>
      search(
        query,
        companies.data ?? [],
        sessions.data?.pages.flatMap((p) => p.items) ?? [],
      ),
    [query, companies.data, sessions.data],
  );
  const showing = open && query.trim() !== "";

  useEffect(() => setActive(0), [query]);

  // "/" focuses the box from anywhere that is not a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A click anywhere else closes the list.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (r: Result) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    navigate(r.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && showing && results[active]) {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === "Escape") {
      if (query) setQuery("");
      else inputRef.current?.blur();
      setOpen(false);
    }
  };

  let index = -1;
  return (
    <div ref={boxRef} data-tour="search" className="relative w-full max-w-md">
      <label htmlFor={`${listId}-in`} className="sr-only">
        Search pages, companies and sessions
      </label>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        id={`${listId}-in`}
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          showing && results[active] ? `${listId}-${active}` : undefined
        }
        autoComplete="off"
        value={query}
        placeholder="Search…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="input w-full !rounded-full !bg-surface !pl-10 !pr-12 shadow-card [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded-md bg-canvas px-1.5 text-xs text-muted sm:block"
      >
        /
      </kbd>
      {showing && (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 z-30 mt-2 max-h-[70vh] overflow-auto rounded-2xl bg-surface p-2 shadow-lift"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">
              Nothing found for “{query.trim()}”.
            </p>
          ) : (
            GROUPS.map((g) => {
              const rows = results.filter((r) => r.group === g);
              if (rows.length === 0) return null;
              return (
                <div key={g} role="group" aria-label={g} className="py-1">
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {g}
                  </p>
                  {rows.map((r) => {
                    index += 1;
                    const i = index;
                    return (
                      <div
                        key={r.id}
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        onMouseEnter={() => setActive(i)}
                        onMouseDown={(e) => e.preventDefault()} // keep focus so the click lands
                        onClick={() => go(r)}
                        className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-xl px-3 py-2.5 text-sm ${
                          i === active ? "bg-accent-soft" : ""
                        }`}
                      >
                        <span className="font-medium">{r.label}</span>
                        {r.hint && (
                          <span className="truncate text-xs text-muted">
                            {r.hint}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
