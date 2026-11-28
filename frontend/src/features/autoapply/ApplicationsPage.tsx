import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { LoadingRows } from "../../ui/Loading";
import {
  retrySummary,
  useApplications,
  useRecheckSkipped,
  useRetryFailed,
} from "./api";
import { Pill, STAGE, day } from "./ui";

const TABS: [string, string][] = [
  ["", "All"],
  ["submitted,sent_email,confirmation_pending", "Sent"],
  ["queued,sending", "Ready to send"],
  ["needs_input", "Needs your input"],
  ["apply_yourself,applied_by_you", "Apply yourself"],
  ["skipped", "Skipped"],
  ["expired", "Expired"],
  ["failed", "Failed"],
];

// the dashboard's numbers open the list already filtered: ?show=sent|ready|skipped|apply
const SHOW: Record<string, string> = {
  sent: "submitted,sent_email,confirmation_pending",
  ready: "queued,sending",
  skipped: "skipped",
  expired: "expired",
  apply: "apply_yourself,applied_by_you",
  failed: "failed",
  needs: "needs_input",
};

export function ApplicationsPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(SHOW[params.get("show") ?? ""] ?? "");
  const q = useApplications(tab);
  const recheck = useRecheckSkipped();
  const retry = useRetryFailed();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loadingAll, setLoadingAll] = useState(false);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const skippedTab = tab === "skipped";
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // every skipped role, including older pages that are not on screen yet
  const selectAll = async () => {
    setLoadingAll(true);
    try {
      const r = q;
      let more = q.hasNextPage;
      let pages = q.data?.pages ?? [];
      while (more) {
        const next = await r.fetchNextPage();
        pages = next.data?.pages ?? pages;
        more = next.hasNextPage;
      }
      setPicked(new Set(pages.flatMap((p) => p.items.map((a) => a.id))));
    } finally {
      setLoadingAll(false);
    }
  };
  const check = () =>
    recheck.mutate([...picked], { onSuccess: () => setPicked(new Set()) });
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
            onClick={() => {
              setTab(value);
              setPicked(new Set());
              recheck.reset();
              retry.reset();
            }}
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
      {skippedTab && items.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-secondary"
            disabled={loadingAll || recheck.isPending}
            onClick={() =>
              picked.size > 0 && !q.hasNextPage && picked.size === items.length
                ? setPicked(new Set())
                : void selectAll()
            }
          >
            {picked.size > 0 && !q.hasNextPage && picked.size === items.length
              ? "Clear selection"
              : loadingAll
                ? "Selecting…"
                : "Select all skipped"}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={picked.size === 0 || recheck.isPending}
            onClick={check}
          >
            {recheck.isPending
              ? "Checking…"
              : `Check again${picked.size > 0 ? ` (${picked.size})` : ""}`}
          </button>
          <span className="text-sm text-muted">
            Pick the roles to judge again against your search as it is now.
          </span>
        </div>
      )}
      {tab === "failed" && items.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={retry.isPending}
            onClick={() => retry.mutate([])}
          >
            {retry.isPending ? "Trying again…" : "Try all failed ones again"}
          </button>
          <span className="text-sm text-muted">
            Each is prepared again with your latest answers and goes back in the
            queue. One that may already have reached the employer is never sent
            twice.
          </span>
        </div>
      )}
      {retry.data && (
        <p role="status" className="rounded-2xl bg-accent-soft p-3 text-sm">
          {retrySummary(retry.data)}
        </p>
      )}
      {retry.isError && (
        <p role="alert" className="notice-error">
          {retry.error.message}
        </p>
      )}
      {recheck.data && (
        <p role="status" className="rounded-2xl bg-accent-soft p-3 text-sm">
          Checked {recheck.data.checked}.{" "}
          {recheck.data.now_ready > 0
            ? `${recheck.data.now_ready} are no longer skipped.`
            : "None are ready yet."}{" "}
          {recheck.data.still_skipped > 0 &&
            `${recheck.data.still_skipped} are still skipped, with the reason shown on each.`}
        </p>
      )}
      {recheck.isError && (
        <p role="alert" className="notice-error">
          {recheck.error.message}
        </p>
      )}
      <ul className="grid gap-3 xl:grid-cols-2">
        {items.map((a) => (
          <li
            key={a.id}
            className="card flex flex-wrap items-center justify-between gap-2"
          >
            {skippedTab && (
              <input
                type="checkbox"
                aria-label={`Select ${a.posting.title} at ${a.posting.company}`}
                className="h-5 w-5 shrink-0 accent-accent"
                checked={picked.has(a.id)}
                onChange={() => toggle(a.id)}
              />
            )}
            <div className="min-w-0 flex-1">
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
