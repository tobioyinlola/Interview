import { Link, useSearchParams } from "react-router-dom";

import { Loading } from "../../../ui/Loading";
import type { AutoRun } from "../../../api/types";
import { useRun, useRunControl, useRunLive, useRunSettings } from "./api";

const STATE: Record<AutoRun["state"], { label: string; tone: string }> = {
  idle: { label: "Not set up", tone: "bg-line text-muted" },
  running: { label: "Running", tone: "bg-emerald-100 text-emerald-900" },
  paused: { label: "Paused", tone: "bg-amber-100 text-amber-900" },
  stopped: { label: "Stopped", tone: "bg-red-100 text-red-900" },
  ended: { label: "Finished", tone: "bg-line text-muted" },
};

const EVENT_TONE: Record<string, string> = {
  submission_verified: "bg-emerald-500",
  application_failed: "bg-red-500",
  review_required: "bg-amber-500",
  application_skipped: "bg-slate-400",
  application_cancelled: "bg-slate-400",
  application_paused: "bg-amber-500",
};

function when(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function Count({
  label,
  value,
  hint,
  to,
}: {
  label: string;
  value: number;
  hint?: string;
  to?: string;
}) {
  const body = (
    <div className="h-full rounded-2xl bg-surface p-4 shadow-card">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="block min-w-0 transition-shadow hover:shadow-lift">
      {body}
    </Link>
  ) : (
    body
  );
}

/** A live view of the application run, with controls that act on it. The same page is the control
 *  panel beside the employer's page in the desktop app's workspace (?workspace=1). */
export function RunPage() {
  const [params] = useSearchParams();
  const workspace = params.get("workspace") === "1";
  const q = useRun();
  const control = useRunControl();
  const settings = useRunSettings();
  useRunLive(q.data?.last_seq, Boolean(q.data));

  if (q.isPending) return <Loading label="Loading the run" />;
  if (q.isError || !q.data)
    return (
      <main className="page-narrow">
        <p role="alert" className="notice-error">
          The run could not be loaded.
        </p>
      </main>
    );
  const r = q.data;
  const cur = r.current;
  const busy = control.isPending;
  const live = r.state === "running" || r.state === "paused";
  const running = Boolean(
    cur &&
    !["Done", "Failed", "Skipped", "Cancelled", "Waiting for you"].includes(
      cur.stage ?? "",
    ),
  );
  const history = [...r.events].reverse();

  return (
    <main className={workspace ? "space-y-4 p-4" : "page-narrow"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Application run
          </h1>
          <p className="text-sm text-muted">
            {r.forms_run_on === "desktop"
              ? "Forms are filled in on your computer, where you can watch."
              : "Forms are filled in on our servers, even when your computer is off."}{" "}
            {!workspace && (
              <Link to="/auto-apply" className="text-accent-dark underline">
                Back to Auto-Apply
              </Link>
            )}
          </p>
        </div>
        <span
          role="status"
          className={`inline-flex rounded-full px-3 py-1.5 text-sm font-medium ${STATE[r.state].tone}`}
        >
          {STATE[r.state].label}
        </span>
      </div>

      <section aria-label="Controls" className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          {(r.state === "stopped" || r.state === "idle") && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || r.state === "idle"}
              onClick={() => control.mutate("start")}
            >
              Start
            </button>
          )}
          {r.state === "running" && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => control.mutate("pause")}
            >
              Pause
            </button>
          )}
          {r.state === "paused" && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => control.mutate("resume")}
            >
              Resume
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !running}
            onClick={() => control.mutate("skip")}
          >
            Skip this one
          </button>
          <button
            type="button"
            className="btn-danger-outline"
            disabled={busy || !live}
            onClick={() => control.mutate("stop")}
          >
            Stop
          </button>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="text-sm">
            <span className="block text-muted">Speed</span>
            <select
              className="input mt-1"
              value={r.speed}
              disabled={settings.isPending}
              onChange={(e) =>
                settings.mutate({
                  speed: e.target.value as "slow" | "normal" | "fast",
                })
              }
            >
              <option value="slow">Slow: 3 minutes apart</option>
              <option value="normal">Normal: 75 seconds apart</option>
              <option value="fast">Fast: 30 seconds apart</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-muted">Fill in forms on</span>
            <select
              className="input mt-1"
              value={r.execution_mode}
              disabled={settings.isPending}
              onChange={(e) =>
                settings.mutate({
                  execution_mode: e.target.value as
                    "auto" | "desktop" | "cloud",
                })
              }
            >
              <option value="auto">
                Automatic: my computer when it is open
              </option>
              <option value="desktop">My computer only</option>
              <option value="cloud">Our servers only</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-muted">
          Speed never goes past your daily limit or the hours you set.
          {r.desktop_open
            ? ` Your computer${r.executors[0] ? ` (${r.executors[0].name})` : ""} is open.`
            : " Your computer is not open."}
        </p>
        {(control.isError || settings.isError) && (
          <p role="alert" className="notice-error">
            {(control.error ?? settings.error)?.message}
          </p>
        )}
      </section>

      <section aria-label="Right now" className="card space-y-3">
        <h2 className="font-semibold">Right now</h2>
        {!cur ? (
          <p className="text-sm text-muted">
            {r.state === "running"
              ? "Waiting for the next application."
              : "Nothing is being applied for."}
          </p>
        ) : (
          <>
            <div>
              <p className="text-lg font-semibold">
                {cur.title} at {cur.company}
              </p>
              <p className="text-sm text-muted">
                {cur.ats_label ?? "Company form"}
                {cur.score !== null && cur.score !== undefined
                  ? ` · ${Math.round(cur.score * 100)}% match`
                  : ""}
                {cur.executor
                  ? ` · on ${cur.executor === "desktop" ? "your computer" : "our servers"}`
                  : ""}
              </p>
            </div>
            <div>
              <div className="flex justify-between text-sm">
                <span>{cur.stage}</span>
                <span className="text-muted">
                  {cur.fields_total > 0
                    ? `${cur.fields_done} of ${cur.fields_total} fields`
                    : ""}
                  {cur.step > 1 ? ` · step ${cur.step}` : ""}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Application progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={cur.progress}
                className="mt-1 h-2 overflow-hidden rounded-full bg-line"
              >
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${cur.progress}%` }}
                />
              </div>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">CV being sent</dt>
                <dd>{cur.cv_version ?? "–"}</dd>
              </div>
              <div>
                <dt className="text-muted">Current question</dt>
                <dd>{cur.question ?? "–"}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <dl aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Count
          label="Queued"
          value={r.counters.queued}
          to="/auto-apply/applications?show=ready"
        />
        <Count
          label="Verified"
          value={r.counters.verified}
          hint={`${r.counters.verified_today} today`}
          to="/auto-apply/applications?show=sent"
        />
        <Count
          label="Failed"
          value={r.counters.failed}
          to="/auto-apply/applications"
        />
        <Count
          label="Skipped"
          value={r.counters.skipped}
          to="/auto-apply/applications?show=skipped"
        />
        <Count
          label="Needs you"
          value={r.counters.needs_you}
          hint="questions, checks, sign-ins"
          to="/auto-apply/applications"
        />
      </dl>

      <section aria-label="Activity" className="card space-y-2">
        <h2 className="font-semibold">Activity</h2>
        {history.length === 0 && (
          <p className="text-sm text-muted">Nothing has happened yet.</p>
        )}
        <ol className="max-h-80 space-y-1.5 overflow-y-auto">
          {history.map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${EVENT_TONE[e.kind] ?? "bg-accent"}`}
              />
              <span className="min-w-0 flex-1">
                {e.text}
                {typeof e.data.label === "string" && e.data.label
                  ? `: ${e.data.label}`
                  : ""}
                {typeof e.data.reason === "string" && e.data.reason
                  ? ` (${e.data.reason})`
                  : ""}
              </span>
              <time className="shrink-0 text-xs text-muted" dateTime={e.at}>
                {when(e.at)}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
