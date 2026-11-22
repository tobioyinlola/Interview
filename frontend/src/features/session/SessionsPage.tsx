import { useState } from "react";
import { Link } from "react-router-dom";

import { useDeleteSession, useSessions } from "../../api/hooks";
import { formatDuration, formatWhen } from "../review/format";
import { LoadingRows } from "../../ui/Loading";

/** Past sessions, newest first: date, length, company and number of questions. */
export function SessionsPage() {
  const q = useSessions();
  const del = useDeleteSession();
  const [confirm, setConfirm] = useState<string | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <main className="page-narrow">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Sessions</h1>
        <Link to="/session/new" className="btn-primary">
          Start interview
        </Link>
      </div>
      {q.isPending && <LoadingRows />}
      {q.isError && (
        <p>Couldn&apos;t load your sessions. Reload to try again.</p>
      )}
      {q.isSuccess && items.length === 0 && (
        <p className="text-muted">
          No sessions yet. After an interview, it appears here with its
          transcript and scores.
        </p>
      )}
      <ul className="list-card">
        {items.map((s) => (
          <li key={s.id} className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Link
                  to={`/sessions/${s.id}`}
                  className="font-medium text-accent-dark underline"
                >
                  {formatWhen(s.started_at)}
                </Link>
                <p className="text-sm text-muted">
                  {s.company_name ?? "No company"} ·{" "}
                  {formatDuration(s.duration_seconds)} · {s.question_count}{" "}
                  question{s.question_count === 1 ? "" : "s"}
                </p>
              </div>
              {confirm === s.id ? (
                <span
                  className="flex gap-2"
                  role="alertdialog"
                  aria-label="Confirm deletion"
                >
                  <button
                    className="btn-danger btn-sm"
                    disabled={del.isPending}
                    onClick={() =>
                      del.mutate(s.id, { onSuccess: () => setConfirm(null) })
                    }
                  >
                    Yes, delete
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setConfirm(null)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  className="btn-secondary btn-sm text-red-700"
                  aria-label={`Delete session from ${formatWhen(s.started_at)}`}
                  onClick={() => setConfirm(s.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {del.isError && (
        <p role="alert" className="text-sm text-red-800">
          {del.error.message}
        </p>
      )}
      {q.hasNextPage && (
        <button
          className="btn-secondary disabled:opacity-50"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {q.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </main>
  );
}
