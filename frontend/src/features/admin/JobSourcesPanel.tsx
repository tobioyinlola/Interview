import { useJobSources } from "./api";
import { Badge, Stat, Table, num, when } from "./ui";

/** Where jobs come from: every company board and feed, read once for everyone. */
export function JobSourcesPanel() {
  const q = useJobSources();
  if (!q.data) return null;
  const d = q.data;
  const failing = d.by_health.failing ?? 0;
  return (
    <section aria-labelledby="sources-h" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="sources-h" className="text-base font-semibold tracking-tight">
          Job boards
        </h2>
        <Badge tone={d.mode === "central" ? "good" : "default"}>
          {d.mode === "central" ? "Read once for everyone" : "Read per person"}
        </Badge>
      </div>
      <dl
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="Job boards"
      >
        <Stat label="Boards and feeds" value={num(d.total)} />
        <Stat label="Jobs they list" value={num(d.jobs_listed)} />
        <Stat label="Healthy" value={num(d.by_health.ok ?? 0)} />
        <Stat
          label="Failing"
          value={num(failing)}
          tone={failing > 0 ? "bad" : "default"}
        />
      </dl>
      {d.failing.length > 0 && (
        <Table label="Failing boards" head={["Board", "Last read", "Why"]}>
          {d.failing.map((s) => (
            <tr key={`${s.kind}:${s.board}`}>
              <td className="px-4 py-3 font-medium">
                {s.company || s.board || s.kind}
                <span className="block text-xs text-muted">{s.kind}</span>
              </td>
              <td className="px-4 py-3 text-muted">{when(s.last_synced_at)}</td>
              <td className="px-4 py-3 text-muted">{s.last_error}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
