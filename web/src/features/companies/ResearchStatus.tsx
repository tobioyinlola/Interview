import type { ResearchJob } from "../../api/types";
import { isActive } from "../../api/polling";

const STEPS = [
  ["queued", "Queued"],
  ["reading_pages", "Reading pages"],
  ["searching", "Searching the web"],
  ["writing", "Writing the brief"],
] as const;

const STALE_DAYS = 7;

export function daysSince(
  iso: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000);
}

interface Props {
  job: ResearchJob | null;
  lastResearchedAt: string | null;
  onResearch: () => void;
  researching: boolean;
  rerunError?: string | null;
}

export function ResearchStatus({
  job,
  lastResearchedAt,
  onResearch,
  researching,
  rerunError,
}: Props) {
  const active = isActive(job?.status);
  const age = daysSince(lastResearchedAt);
  const index = STEPS.findIndex(([k]) => k === job?.status);

  return (
    <section aria-labelledby="rs" className="rounded border p-4">
      <h2 id="rs" className="text-lg font-medium">
        Research
      </h2>

      {/* One live region, so progress is announced without stealing focus. */}
      <div role="status" aria-live="polite" className="mt-2">
        {active && job && (
          <>
            <ol className="flex flex-wrap gap-2 text-sm">
              {STEPS.map(([key, label], i) => (
                <li
                  key={key}
                  aria-current={i === index ? "step" : undefined}
                  className={`rounded px-2 py-1 ${
                    i === index
                      ? "bg-accent-soft font-medium"
                      : i < index
                        ? "text-muted"
                        : "text-muted"
                  }`}
                >
                  {i < index ? "✓ " : ""}
                  {label}
                </li>
              ))}
            </ol>
            {job.step_detail && (
              <p className="mt-1 text-sm text-muted">{job.step_detail}</p>
            )}
            <p className="mt-1 text-sm text-muted">
              You can leave this page. Research keeps going and the brief will
              be here when you come back.
            </p>
          </>
        )}
        {job?.status === "ready" && (
          <p>
            Brief ready.{" "}
            {age !== null && (
              <span
                className={
                  age > STALE_DAYS ? "font-medium text-amber-800" : "text-muted"
                }
              >
                Researched{" "}
                {age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}
                {age > STALE_DAYS ? " — consider researching again." : "."}
              </span>
            )}
          </p>
        )}
        {job?.status === "failed" && (
          <p className="text-red-800">
            Research didn&apos;t finish. {job.error ?? "Something went wrong."}
          </p>
        )}
        {!job && (
          <p className="text-muted">
            This company hasn&apos;t been researched yet.
          </p>
        )}
      </div>

      {rerunError && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {rerunError}
        </p>
      )}
      <button
        className="mt-3 rounded border px-3 py-2 disabled:opacity-50"
        disabled={active || researching}
        onClick={onResearch}
      >
        {job ? "Research again" : "Research"}
      </button>
    </section>
  );
}
