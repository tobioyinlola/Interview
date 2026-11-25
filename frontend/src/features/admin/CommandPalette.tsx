import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { SearchIcon } from "../../app/icons";

export type Place = { to: string; label: string; group: string };

/** Jump anywhere in the back office from the keyboard: type part of a section's name, or someone's
 *  name or email to look them up. Opens with Ctrl+K / ⌘K or the Jump to button. */
export function CommandPalette({
  places,
  onClose,
}: {
  places: Place[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const found = places.filter(
      (p) =>
        !term ||
        p.label.toLowerCase().includes(term) ||
        p.group.toLowerCase().includes(term),
    );
    const out = found.map((p) => ({
      key: p.to,
      label: p.label,
      hint: p.group,
      to: p.to,
    }));
    if (term)
      out.push({
        key: "people",
        label: `Find people matching “${q.trim()}”`,
        hint: "Users",
        to: `/admin/users?q=${encodeURIComponent(q.trim())}`,
      });
    return out;
  }, [q, places]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const pick = Math.min(at, Math.max(0, rows.length - 1));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/50 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-lift"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt((i) => Math.min(rows.length - 1, i + 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt((i) => Math.max(0, i - 1));
          }
          if (e.key === "Enter" && rows[pick]) go(rows[pick].to);
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3 shadow-[0_1px_0_0_rgba(28,27,46,0.06)]">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            aria-label="Where to?"
            placeholder="Go to a section, or find a person"
            className="min-h-[44px] w-full bg-transparent text-base focus:outline-none"
          />
          <kbd className="hidden rounded-md bg-canvas px-1.5 py-0.5 text-[11px] text-muted sm:block">
            esc
          </kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
          {rows.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted">
              Nothing matches.
            </li>
          )}
          {rows.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === pick}>
              <button
                type="button"
                onClick={() => go(r.to)}
                onMouseMove={() => setAt(i)}
                className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm ${
                  i === pick ? "bg-accent-soft text-accent-dark" : ""
                }`}
              >
                <span className="truncate font-medium">{r.label}</span>
                <span className="shrink-0 text-xs text-muted">{r.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
