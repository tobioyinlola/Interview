import { useRetryTask, useWorker } from "./api";
import { Badge, Empty, Stat, Table, num, when } from "./ui";

const mins = (s: number) =>
  s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;

/** The one background worker: is it keeping up, what gave up, and where its time goes. */
export function WorkerPanel() {
  const q = useWorker();
  const retry = useRetryTask();
  if (!q.data) return null;
  const d = q.data;
  const queued = d.by_status.queued ?? 0;
  const lagging = d.oldest_due_seconds > 600;
  return (
    <section aria-labelledby="worker-h" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="worker-h" className="text-base font-semibold tracking-tight">
          Background work
        </h2>
        <Badge tone={d.mode === "worker" ? "good" : "default"}>
          {d.mode === "worker" ? "Runs in the worker" : "Runs in the API"}
        </Badge>
      </div>
      <dl
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="Background queue"
      >
        <Stat label="Waiting" value={num(queued)} />
        <Stat label="Running" value={num(d.by_status.running ?? 0)} />
        <Stat
          label="Oldest waiting"
          value={mins(d.oldest_due_seconds)}
          tone={lagging ? "warn" : "default"}
          hint={lagging ? "falling behind: add capacity" : "keeping up"}
        />
        <Stat
          label="Gave up"
          value={num(d.by_status.dead ?? 0)}
          tone={(d.by_status.dead ?? 0) > 0 ? "bad" : "default"}
        />
      </dl>
      {d.kinds.length > 0 && (
        <Table
          label="Background work by kind"
          head={["Kind", "Tasks (24 h)", "Worker time", "Waiting", "Gave up"]}
        >
          {d.kinds.map((k) => (
            <tr key={k.kind}>
              <td className="px-4 py-3 font-medium">{k.kind}</td>
              <td className="px-4 py-3">{num(k.tasks)}</td>
              <td className="px-4 py-3">{mins(k.run_seconds)}</td>
              <td className="px-4 py-3">{num(k.queued)}</td>
              <td className="px-4 py-3">{num(k.dead)}</td>
            </tr>
          ))}
        </Table>
      )}
      {d.dead.length === 0 ? (
        d.kinds.length === 0 && <Empty>No background work yet.</Empty>
      ) : (
        <Table label="Tasks that gave up" head={["Kind", "Why", "When", ""]}>
          {d.dead.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-3 font-medium">{t.kind}</td>
              <td className="px-4 py-3 text-muted">
                {t.error_class}: {t.last_error}
              </td>
              <td className="px-4 py-3 text-muted">{when(t.finished_at)}</td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate(t.id)}
                >
                  Try again
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
