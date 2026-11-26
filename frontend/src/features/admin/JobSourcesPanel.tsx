import { useMemo, useState } from "react";

import { API_BASE_URL } from "../../api/client";
import type { AdminJobSource } from "../../api/types";
import { jobSourcesCsvUrl, useJobSourceList, useJobSources } from "./api";
import { Badge, Stat, Table, num, when } from "./ui";

const KIND_NAMES: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  recruitee: "Recruitee",
  workable: "Workable",
  personio: "Personio",
  remotive: "Remotive feed",
  arbeitnow: "Arbeitnow feed",
  remoteok: "Remote OK feed",
  jobicy: "Jobicy feed",
  himalayas: "Himalayas feed",
  themuse: "The Muse feed",
  workingnomads: "Working Nomads feed",
  weworkremotely: "We Work Remotely feed",
};
const kindName = (k: string) => KIND_NAMES[k] ?? k;
const sourceName = (s: AdminJobSource) =>
  s.company || (s.board ? s.board : kindName(s.kind));

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
      <AllBoards total={d.total} />
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

/** The full list, opened on request: search it, open a board, or download it as a spreadsheet. */
function AllBoards({ total }: { total: number }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const list = useJobSourceList(open);
  const items = useMemo(() => {
    const all = list.data?.items ?? [];
    const f = find.trim().toLowerCase();
    if (!f) return all;
    return all.filter((s) =>
      [s.company, s.board, s.kind, kindName(s.kind)].some((v) =>
        (v ?? "").toLowerCase().includes(f),
      ),
    );
  }, [list.data, find]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide the list" : `See all ${num(total)}`}
        </button>
        <a
          href={jobSourcesCsvUrl(API_BASE_URL)}
          className="btn-secondary"
          download
        >
          Download CSV
        </a>
      </div>
      {open && (
        <>
          <label className="block text-sm sm:max-w-xs">
            <span className="sr-only">Find a board</span>
            <input
              type="search"
              className="input w-full"
              placeholder="Find a company or board"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
          </label>
          {list.isLoading && <p className="text-sm text-muted">Loading…</p>}
          {list.data && (
            <>
              <p className="text-sm text-muted" aria-live="polite">
                {find.trim()
                  ? `${num(items.length)} of ${num(list.data.items.length)}`
                  : `${num(items.length)} boards and feeds, the busiest first`}
              </p>
              <Table
                label="All job boards"
                head={["Board", "Jobs", "Health", "Last read"]}
              >
                {items.map((s) => (
                  <tr key={`${s.kind}:${s.board}`}>
                    <td className="px-4 py-3 font-medium">
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                        >
                          {sourceName(s)}
                        </a>
                      ) : (
                        sourceName(s)
                      )}
                      <span className="block text-xs text-muted">
                        {kindName(s.kind)}
                        {s.origin === "startup"
                          ? " · found via startup research"
                          : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {num(s.jobs_listed)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={
                          s.health === "ok"
                            ? "good"
                            : s.health === "failing"
                              ? "bad"
                              : "default"
                        }
                      >
                        {s.health === "ok"
                          ? "Healthy"
                          : s.health === "failing"
                            ? "Failing"
                            : "Not read yet"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {when(s.last_synced_at)}
                    </td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </>
      )}
    </div>
  );
}
