import { useState } from "react";
import { Link } from "react-router-dom";

import { LoadingRows } from "../../ui/Loading";
import { useApplications } from "./api";
import { Pill, STAGE, day } from "./ui";

const TABS: [string, string][] = [
  ["", "All"],
  ["submitted,sent_email,confirmation_pending", "Sent"],
  ["queued,sending", "Ready to send"],
  ["needs_input", "Needs your input"],
  ["apply_yourself,applied_by_you", "Apply yourself"],
  ["skipped", "Skipped"],
  ["failed", "Failed"],
];

export function ApplicationsPage() {
  const [tab, setTab] = useState("");
  const q = useApplications(tab);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <main className="page-narrow">
      <h1 className="text-3xl font-semibold tracking-tight">Applications</h1>
      <p className="text-sm text-muted">
        Everything Auto-Apply found, sent or skipped, and why.{" "}
        <Link to="/auto-apply" className="text-accent-dark underline">
          Back to Auto-Apply
        </Link>
      </p>
      <div
        role="tablist"
        aria-label="Filter applications"
        className="flex flex-wrap gap-2"
      >
        {TABS.map(([value, name]) => (
          <button
            key={name}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-sm ${
              tab === value
                ? "bg-ink text-surface"
                : "bg-line text-muted hover:text-ink"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      {q.isPending && <LoadingRows label="Loading applications" />}
      {q.isError && (
        <p role="alert" className="notice-error">
          Applications could not be loaded.
        </p>
      )}
      {q.data && items.length === 0 && (
        <p className="card text-sm text-muted">Nothing here yet.</p>
      )}
      <ul className="grid gap-3 xl:grid-cols-2">
        {items.map((a) => (
          <li
            key={a.id}
            className="card flex flex-wrap items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <Link
                to={`/auto-apply/applications/${a.id}`}
                className="font-medium text-accent-dark underline"
              >
                {a.posting.title}
              </Link>
              <p className="text-sm text-muted">
                {a.posting.company}
                {a.posting.region ? ` · ${a.posting.region}` : ""} ·{" "}
                {day(a.created_at)}
              </p>
              {a.skip_reason && (
                <p className="text-xs text-muted">{a.skip_reason}</p>
              )}
            </div>
            <span className="flex items-center gap-2">
              {a.recruiting_stage && (
                <span className="text-xs text-muted">
                  {STAGE[a.recruiting_stage] ?? a.recruiting_stage}
                </span>
              )}
              <Pill status={a.status} />
            </span>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <button
          type="button"
          className="btn-secondary"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          Show older
        </button>
      )}
    </main>
  );
}
