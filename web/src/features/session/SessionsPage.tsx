import { useState } from "react";
import { Link } from "react-router-dom";

import { useDeleteSession, useSessions } from "../../api/hooks";
import { formatDuration, formatWhen } from "../review/format";

/** Past sessions, newest first: date, length, company and number of questions. */
export function SessionsPage() {
  const q = useSessions();
  const del = useDeleteSession();
  const [confirm, setConfirm] = useState<string | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sessions</h1>
        <Link
          to="/session/new"
          className="rounded bg-blue-700 px-3 py-2 text-white"
        >
          Start practice
        </Link>
      </div>
      {q.isPending && <p>Loading…</p>}
      {q.isError && (
        <p>Couldn&apos;t load your sessions. Reload to try again.</p>
      )}
      {q.isSuccess && items.length === 0 && (
        <p className="text-gray-600">
          No sessions yet. After a practice call, it appears here with its
          transcript and scores.
        </p>
      )}
      <ul className="divide-y rounded border">
        {items.map((s) => (
          <li key={s.id} className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Link
                  to={`/sessions/${s.id}`}
                  className="font-medium text-blue-700 underline"
                >
                  {formatWhen(s.started_at)}
                </Link>
                <p className="text-sm text-gray-600">
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
                    className="rounded bg-red-700 px-2 py-1 text-sm text-white disabled:opacity-50"
                    disabled={del.isPending}
                    onClick={() =>
                      del.mutate(s.id, { onSuccess: () => setConfirm(null) })
                    }
                  >
                    Yes, delete
                  </button>
                  <button
                    className="rounded border px-2 py-1 text-sm"
                    onClick={() => setConfirm(null)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  className="rounded border px-2 py-1 text-sm text-red-700"
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
          className="rounded border px-3 py-2 disabled:opacity-50"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {q.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </main>
  );
}
