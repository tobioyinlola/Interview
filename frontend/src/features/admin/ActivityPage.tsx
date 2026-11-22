import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { API_BASE_URL } from "../../api/client";
import { activityCsvUrl, useActivity } from "./api";
import { Empty, Failed, Loading, PageHead, when } from "./ui";

const CATEGORY_NAMES: Record<string, string> = {
  account: "Account",
  security: "Security",
  onboarding: "Onboarding",
  content: "CV and companies",
  interview: "Interviews",
  referral: "Invites",
  email: "Emails",
  admin: "Admin actions",
};

const TONE: Record<string, string> = {
  security: "bg-red-100 text-red-800",
  email: "bg-blue-100 text-blue-800",
  interview: "bg-accent-soft text-accent-dark",
  referral: "bg-green-100 text-green-800",
  admin: "bg-ink text-surface",
};

/** The log of everything happening on the platform, newest first, with filters and a CSV download. */
export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const category = params.get("category") ?? "";
  const q = params.get("q") ?? "";
  const user_id = params.get("user_id") ?? undefined;
  const [draft, setDraft] = useState(q);
  const filters = { kind, category, q, user_id };
  const log = useActivity(filters);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch))
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    setParams(next, { replace: true });
  };
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const categories = log.data?.pages[0]?.categories ?? {};

  return (
    <div className="space-y-4">
      <PageHead
        title="Activity log"
        intro="Everything that happens on the platform: sign-ups, sign-ins, interviews, invites, emails and admin actions. It holds facts and counts, never anyone's CV, answers or words. Entries are kept for 180 days."
        right={
          <a
            href={activityCsvUrl(API_BASE_URL, filters)}
            className="btn-secondary"
            download
          >
            Download CSV
          </a>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mr-2 text-muted">Kind</span>
          <select
            value={category}
            onChange={(e) => set({ category: e.target.value, kind: null })}
            className="input !min-h-[40px] !py-1.5"
          >
            <option value="">Everything</option>
            {Object.keys(categories).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_NAMES[c] ?? c}
              </option>
            ))}
          </select>
        </label>
        <form
          role="search"
          aria-label="Search the log"
          className="flex gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            set({ q: draft.trim() });
          }}
        >
          <label className="sr-only" htmlFor="act-q">
            Search by email address
          </label>
          <input
            id="act-q"
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Email address"
            className="input w-56 !min-h-[40px]"
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
        {(kind || category || q || user_id) && (
          <button
            className="text-sm text-accent-dark underline"
            onClick={() => {
              setDraft("");
              setParams({}, { replace: true });
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {log.isPending && <Loading what="the log" />}
      {log.isError && <Failed what="the log" />}
      {log.isSuccess && items.length === 0 && (
        <Empty>Nothing matches those filters.</Empty>
      )}
      {items.length > 0 && (
        <ol aria-label="Platform activity" className="list-card">
          {items.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 text-sm"
            >
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[e.category] ?? "bg-canvas text-muted"}`}
              >
                {CATEGORY_NAMES[e.category] ?? e.category}
              </span>
              <span className="font-medium">{e.label}</span>
              {e.user_email && (
                <Link
                  to={`/admin/users/${e.user_id}`}
                  className="text-accent-dark underline"
                >
                  {e.user_email}
                </Link>
              )}
              {e.actor_email && (
                <span className="text-muted">by {e.actor_email}</span>
              )}
              {e.detail && <span className="text-muted">· {e.detail}</span>}
              <time dateTime={e.at} className="ml-auto text-xs text-muted">
                {when(e.at)}
              </time>
            </li>
          ))}
        </ol>
      )}
      {log.hasNextPage && (
        <button
          className="btn-secondary"
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {log.isFetchingNextPage ? "Loading…" : "Load older entries"}
        </button>
      )}
    </div>
  );
}
