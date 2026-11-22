import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Loading } from "../../ui/Loading";
import {
  useAddJob,
  useCampaignActions,
  useDashboard,
  usePrepareInterview,
  useRecruitingActions,
  useReviewQueue,
  useRunDiscovery,
} from "./api";
import {
  DemoNotice,
  Fail,
  Pill,
  STAGE,
  Section,
  SourceChips,
  day,
  when,
} from "./ui";
import type { AAInterview } from "../../api/types";

function NextInterview({ iv }: { iv: AAInterview }) {
  const prepare = usePrepareInterview();
  const { confirmTime } = useRecruitingActions();
  const navigate = useNavigate();
  const [zone, setZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  return (
    <Section id="next-h" title="Next interview">
      <p className="font-medium">
        {iv.title} at {iv.company}
        {iv.round > 1 ? ` · round ${iv.round}` : ""}
      </p>
      <p className="text-sm">{when(iv.scheduled_at)}</p>
      {iv.time_zone_unclear && (
        <div className="notice-warn space-y-2">
          <p>
            The email did not say which time zone this time is in. Tell us, and
            we will show it correctly.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="tz" className="text-sm">
              Time zone it was written in
            </label>
            <input
              id="tz"
              className="input w-56"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={confirmTime.isPending || !iv.last_event_id}
              onClick={() =>
                iv.last_event_id &&
                confirmTime.mutate({ id: iv.last_event_id, timezone: zone })
              }
            >
              Confirm time zone
            </button>
          </div>
          <Fail error={confirmTime.error} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {iv.meeting_url && (
          <a
            href={iv.meeting_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            Open the meeting link
          </a>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={prepare.isPending}
          onClick={() =>
            prepare.mutate(iv.id, {
              onSuccess: (r) => navigate(r.session_url),
            })
          }
        >
          Prepare for interview
        </button>
      </div>
      <Fail error={prepare.error} />
    </Section>
  );
}

function Ring({
  day,
  total,
  active,
}: {
  day: number;
  total: number;
  active: boolean;
}) {
  const r = 46;
  const circ = 2 * Math.PI * r;
  const share = active ? Math.min(day / total, 1) : 0;
  return (
    <div className="relative h-32 w-32 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
        <circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          strokeWidth="9"
          className="stroke-surface/20"
        />
        <circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - share)}
          className="stroke-surface transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-surface">
        <span className="text-3xl font-semibold leading-none">
          {active ? day : total}
        </span>
        <span className="mt-1 text-xs text-surface/75">
          {active ? `of ${total} days` : "days"}
        </span>
      </div>
    </div>
  );
}

const HEADLINE: Record<string, string> = {
  none: "Let Auto-Apply do the applying",
  active: "Auto-Apply is working for you",
  paused: "Auto-Apply is paused",
  ended: "Your 30 days are done",
};

function Hero({
  d,
}: {
  d: NonNullable<ReturnType<typeof useDashboard>["data"]>;
}) {
  const p = d.primary;
  const c = d.campaign;
  const prepare = usePrepareInterview();
  const navigate = useNavigate();
  const running = c.state === "active" || c.state === "paused";
  const text: Record<string, string> = {
    prepare: "You have an interview coming up.",
    book: "An employer wants to schedule an interview.",
    answer: "One of your applications is waiting for you.",
    reconnect: "Your email needs to be connected again before it can send.",
    ended: "Look back at what was sent, or start another 30 days.",
    setup:
      "Tell us what you want once. We find roles and apply for you every day for 30 days.",
    preferences: "Your search is set up and running.",
    last_run:
      "Today's search found no roles that fit. You may want to widen it.",
  };
  const cta = "btn btn-lg bg-surface text-ink hover:bg-canvas";
  return (
    <section
      aria-label="What to do next"
      className="overflow-hidden rounded-3xl bg-gradient-to-br from-ink via-ink to-accent-dark p-6 text-surface shadow-lift sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="min-w-0 flex-1 basis-72 space-y-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface/15 px-3 py-1 text-xs font-medium">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                c.state === "active"
                  ? "animate-pulse bg-emerald-400"
                  : c.state === "paused"
                    ? "bg-amber-300"
                    : "bg-surface/60"
              }`}
            />
            {c.state === "active"
              ? "Running"
              : c.state === "paused"
                ? "Paused"
                : c.state === "ended"
                  ? "Finished"
                  : "Not started"}
          </span>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            {HEADLINE[c.state] ?? "Auto-Apply"}
          </h1>
          <p role="status" className="text-sm text-surface/80">
            {c.state === "none" && "Not set up yet."}
            {running &&
              `${c.state === "paused" ? "Paused" : "On"} · day ${c.day} of ${c.days_total} · ends ${day(c.ends_at)}`}
            {c.state === "ended" && `Finished on ${day(c.ends_at)}.`}
          </p>
          <p className="text-surface/90">{text[p.kind] ?? ""}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {p.kind === "prepare" && p.interview_id ? (
              <button
                type="button"
                className={cta}
                disabled={prepare.isPending}
                onClick={() =>
                  prepare.mutate(p.interview_id as string, {
                    onSuccess: (r) => navigate(r.session_url),
                  })
                }
              >
                {p.label}
              </button>
            ) : p.kind === "book" && p.href ? (
              <a
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cta}
              >
                {p.label}
              </a>
            ) : p.href ? (
              <Link to={p.href} className={cta}>
                {p.label}
              </Link>
            ) : null}
          </div>
          <Fail error={prepare.error} />
        </div>
        <Ring day={c.day ?? 0} total={c.days_total ?? 30} active={running} />
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  bar,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  bar?: number;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
      {bar !== undefined && (
        <div
          aria-hidden="true"
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.min(100, Math.round(bar * 100))}%` }}
          />
        </div>
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export function AutoApplyPage() {
  const dash = useDashboard();
  const review = useReviewQueue();
  const { pause, resume } = useCampaignActions();
  const run = useRunDiscovery();
  const add = useAddJob();
  const recruit = useRecruitingActions();
  const [url, setUrl] = useState("");

  if (dash.isPending) return <Loading label="Loading Auto-Apply" />;
  if (dash.isError || !dash.data)
    return (
      <main className="page-narrow">
        <p role="alert" className="notice-error">
          Auto-Apply could not be loaded. Try again in a moment.
        </p>
      </main>
    );
  const d = dash.data;
  const c = d.campaign;
  const running = c.state === "active" || c.state === "paused";

  const submitJob = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) add.mutate(url.trim(), { onSuccess: () => setUrl("") });
  };

  return (
    <main className="page-narrow">
      {d.demo && <DemoNotice />}

      <Hero d={d} />

      <SourceChips sources={d.sources ?? []} />

      <dl
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label="At a glance"
      >
        <Tile
          label="Sent so far"
          value={(d.counts.submitted ?? 0) + (d.counts.sent_email ?? 0)}
          hint="applications"
        />
        <Tile
          label="Waiting for you"
          value={d.counts.needs_input ?? 0}
          hint={
            d.review_count > 0
              ? `${d.review_count} reply to match`
              : "questions to answer"
          }
        />
        <Tile
          label="Interviews"
          value={d.open_invites.length + (d.next_interview ? 1 : 0)}
          hint="invited or booked"
        />
        {d.usage ? (
          <Tile
            label="Applications today"
            value={`${d.usage.applications_used} of ${d.usage.applications_cap}`}
            bar={
              d.usage.applications_cap
                ? d.usage.applications_used / d.usage.applications_cap
                : 0
            }
          />
        ) : (
          <Tile
            label="Applications today"
            value="–"
            hint="starts once you are set up"
          />
        )}
      </dl>

      {d.next_interview && <NextInterview iv={d.next_interview} />}

      {d.open_invites.length > 0 && (
        <Section id="invites-h" title="Interview invitations">
          <ul className="space-y-2">
            {d.open_invites.map((iv) => (
              <li
                key={iv.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  {iv.title} at {iv.company}
                </span>
                {iv.scheduling_url && (
                  <a
                    href={iv.scheduling_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary"
                  >
                    Book interview
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {d.needs_input.length > 0 && (
        <Section id="needs-h" title="Needs your input">
          <ul className="space-y-3">
            {d.needs_input.map((a) => (
              <li key={a.id} className="space-y-1">
                <Link
                  to={`/auto-apply/applications/${a.id}`}
                  className="font-medium text-accent-dark underline"
                >
                  {a.posting.title} at {a.posting.company}
                </Link>
                <ul className="list-disc pl-5 text-sm text-muted">
                  {(
                    a.needs_input as { question: string; reason: string }[]
                  ).map((n, i) => (
                    <li key={i}>
                      {n.question}: {n.reason}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {review.data && review.data.length > 0 && (
        <Section
          id="review-h"
          title="Employer messages to check"
          hint="These replies could belong to more than one application. Choose the right one."
        >
          <ul className="space-y-4">
            {review.data.map((m) => (
              <li key={m.id} className="space-y-2">
                <p className="text-sm">
                  <span className="font-medium">{m.subject}</span> from{" "}
                  {m.sender}
                </p>
                <div className="flex flex-wrap gap-2">
                  {m.candidates.map((cand) => (
                    <button
                      key={cand.id}
                      type="button"
                      className="btn-secondary"
                      disabled={recruit.link.isPending}
                      onClick={() =>
                        recruit.link.mutate({
                          id: m.id,
                          application_id: cand.id,
                        })
                      }
                    >
                      {cand.title} at {cand.company}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="text-sm text-muted underline"
                    onClick={() => recruit.dismiss.mutate(m.id)}
                  >
                    Not about my applications
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="recent-h" title="Recent applications">
        {d.recent.length === 0 ? (
          <div className="rounded-2xl bg-canvas p-6 text-center">
            <p aria-hidden="true" className="text-3xl">
              📨
            </p>
            <p className="mt-2 font-medium">Nothing has gone out yet</p>
            <p className="text-sm text-muted">
              Applications appear here as they are sent, with what happened
              next.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {d.recent.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/auto-apply/applications/${a.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-canvas p-3 transition-colors hover:bg-accent-soft"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft font-semibold text-accent-dark"
                  >
                    {initial(a.posting.company)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {a.posting.title} at {a.posting.company}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {a.posting.region ?? "Anywhere"}
                    </span>
                  </span>
                  {a.recruiting_stage && (
                    <span className="hidden rounded-full bg-surface px-2.5 py-1 text-xs text-muted sm:inline">
                      {STAGE[a.recruiting_stage] ?? a.recruiting_stage}
                    </span>
                  )}
                  <Pill status={a.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/auto-apply/applications"
          className="inline-flex min-h-[44px] items-center text-sm text-accent-dark hover:underline"
        >
          See all applications →
        </Link>
      </Section>

      <Section id="today-h" title="Today">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {d.usage && (
            <>
              {d.channels.outreach && (
                <div>
                  <dt className="text-muted">Notes to hiring contacts</dt>
                  <dd>
                    {d.usage.outreach_used} of {d.usage.outreach_cap}
                  </dd>
                </div>
              )}
            </>
          )}
          <div>
            <dt className="text-muted">Last search</dt>
            <dd>
              {d.last_run
                ? `${day(d.last_run.started_at)}: ${d.last_run.found} found, ${d.last_run.eligible} matched`
                : "Not run yet"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Email</dt>
            <dd>
              {d.mailbox.connected
                ? `Connected (${d.mailbox.address})`
                : d.mailbox.status === "reauth_needed"
                  ? "Needs reconnecting"
                  : "Not connected"}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {running && c.state === "active" && (
            <button
              type="button"
              className="btn-secondary"
              disabled={pause.isPending}
              onClick={() => pause.mutate()}
            >
              Pause Auto-Apply
            </button>
          )}
          {c.state === "paused" && (
            <button
              type="button"
              className="btn-secondary"
              disabled={resume.isPending}
              onClick={() => resume.mutate()}
            >
              Resume Auto-Apply
            </button>
          )}
          {running && (
            <button
              type="button"
              className="btn-secondary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              Search for roles now
            </button>
          )}
          <Link to="/auto-apply/setup" className="btn-secondary">
            Search preferences
          </Link>
        </div>
        <Fail error={pause.error ?? resume.error ?? run.error} />
      </Section>

      {running && (
        <Section
          id="job-h"
          title="Add a job yourself"
          hint="Paste a link to a job. It is checked against your search like any other."
        >
          <form onSubmit={submitJob} className="flex flex-wrap gap-2">
            <label htmlFor="job-url" className="sr-only">
              Job link
            </label>
            <input
              id="job-url"
              type="url"
              className="input min-w-0 flex-1"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button className="btn-secondary" disabled={add.isPending}>
              Add job
            </button>
          </form>
          <Fail error={add.error} />
        </Section>
      )}
    </main>
  );
}
