import { Link } from "react-router-dom";

import { currentEnv, isSupported } from "../../app/browserSupport";
import { useCompanies, useNotes, useSessions } from "../../api/hooks";
import { daysSince } from "../companies/ResearchStatus";
import { formatDuration, formatWhen } from "../review/format";

const STALE_DAYS = 7;

function Item({
  ok,
  warn,
  children,
}: {
  ok: boolean;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true">{ok ? (warn ? "!" : "✓") : "○"}</span>
      <span>
        <span className="sr-only">
          {ok ? (warn ? "Needs attention: " : "Done: ") : "Not done: "}
        </span>
        {children}
      </span>
    </li>
  );
}

/** What to do next: notes saved, a fresh brief, a browser that can share tab audio. */
function ReadinessCard() {
  const notes = useNotes();
  const companies = useCompanies();
  const notesSaved = (notes.data?.content ?? "").trim().length > 0;
  const researched = (companies.data ?? []).filter(
    (c) => c.job_status === "ready" && c.last_researched_at,
  );
  const newest = researched
    .map((c) => daysSince(c.last_researched_at) ?? 0)
    .sort((a, b) => a - b)[0];
  const hasBrief = researched.length > 0;
  const stale = hasBrief && newest > STALE_DAYS;
  const canCapture = isSupported(currentEnv());
  const ready = notesSaved && canCapture;

  return (
    <section aria-labelledby="ready-h" className="space-y-2 rounded border p-4">
      <h2 id="ready-h" className="text-lg font-medium">
        Readiness
      </h2>
      <ul className="space-y-1 text-sm">
        <Item ok={notesSaved}>
          Notes saved{" "}
          {!notesSaved && (
            <Link to="/notes" className="text-blue-700 underline">
              Add your notes
            </Link>
          )}
        </Item>
        <Item ok={hasBrief} warn={stale}>
          {hasBrief
            ? stale
              ? `Company brief is ${newest} days old. Consider researching again.`
              : "Company brief ready and fresh"
            : "Company brief (optional)"}{" "}
          {!hasBrief && (
            <Link to="/companies" className="text-blue-700 underline">
              Add a company
            </Link>
          )}
        </Item>
        <Item ok={canCapture}>Browser can share tab audio</Item>
        <Item ok={false}>
          Partner consent: you confirm it when you start a session
        </Item>
      </ul>
      <Link
        to="/session/new"
        className={`inline-block rounded px-3 py-2 ${ready ? "bg-blue-700 text-white" : "border"}`}
      >
        Start practice
      </Link>
    </section>
  );
}

export function DashboardPage() {
  const companies = useCompanies();
  const sessions = useSessions();
  const recent = (sessions.data?.pages[0]?.items ?? []).slice(0, 5);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <ReadinessCard />

      <section aria-labelledby="co-h" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 id="co-h" className="text-lg font-medium">
            Companies
          </h2>
          <Link to="/companies" className="text-sm text-blue-700 underline">
            All companies
          </Link>
        </div>
        {companies.isSuccess && companies.data.length === 0 && (
          <p className="text-gray-600">No companies yet.</p>
        )}
        <ul className="divide-y rounded border">
          {(companies.data ?? []).slice(0, 5).map((c) => (
            <li key={c.id} className="flex justify-between p-2">
              <Link
                to={`/companies/${c.id}`}
                className="text-blue-700 underline"
              >
                {c.name}
              </Link>
              <span className="text-sm text-gray-600">
                {c.job_status === "ready"
                  ? "Brief ready"
                  : c.job_status === "failed"
                    ? "Research failed"
                    : c.job_status
                      ? "Researching…"
                      : "Not researched"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="se-h" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 id="se-h" className="text-lg font-medium">
            Recent sessions
          </h2>
          <Link to="/sessions" className="text-sm text-blue-700 underline">
            All sessions
          </Link>
        </div>
        {sessions.isSuccess && recent.length === 0 && (
          <p className="text-gray-600">No sessions yet.</p>
        )}
        <ul className="divide-y rounded border">
          {recent.map((s) => (
            <li key={s.id} className="p-2">
              <Link
                to={`/sessions/${s.id}`}
                className="text-blue-700 underline"
              >
                {formatWhen(s.started_at)}
              </Link>
              <span className="ml-2 text-sm text-gray-600">
                {s.company_name ?? "No company"} ·{" "}
                {formatDuration(s.duration_seconds)} · {s.question_count}{" "}
                question{s.question_count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
