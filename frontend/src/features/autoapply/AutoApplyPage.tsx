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
import { Fail, Pill, STAGE, Section, day, when } from "./ui";
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

function PrimaryCard({
  d,
}: {
  d: NonNullable<ReturnType<typeof useDashboard>["data"]>;
}) {
  const p = d.primary;
  const prepare = usePrepareInterview();
  const navigate = useNavigate();
  const text: Record<string, string> = {
    prepare: "You have an interview coming up.",
    book: "An employer wants to schedule an interview.",
    answer: "One of your applications is waiting for you.",
    reconnect: "Your email needs to be connected again before it can send.",
    ended: "Your 30-day search has finished.",
    setup: "Let it find and apply to roles for you for 30 days.",
    preferences: "Your search is set up.",
    last_run: "Today's search found no roles that fit.",
  };
  return (
    <section aria-label="What to do next" className="card space-y-3">
      <p className="text-sm text-muted">{text[p.kind] ?? ""}</p>
      {p.kind === "prepare" && p.interview_id ? (
        <button
          type="button"
          className="btn-primary btn-lg"
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
          className="btn-primary btn-lg"
        >
          {p.label}
        </a>
      ) : p.href ? (
        <Link to={p.href} className="btn-primary btn-lg">
          {p.label}
        </Link>
      ) : null}
      <Fail error={prepare.error} />
    </section>
  );
}

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
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Auto-Apply</h1>
        <p role="status" className="text-sm text-muted">
          {c.state === "none" && "Not set up yet."}
          {running &&
            `${c.state === "paused" ? "Paused" : "On"} · day ${c.day} of ${c.days_total} · ends ${day(c.ends_at)}`}
          {c.state === "ended" && `Finished on ${day(c.ends_at)}.`}
        </p>
      </header>

      <PrimaryCard d={d} />

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
          <p className="text-sm text-muted">
            Nothing has been sent yet. Applications appear here as they go out.
          </p>
        ) : (
          <ul className="space-y-1">
            {d.recent.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <Link
                  to={`/auto-apply/applications/${a.id}`}
                  className="text-accent-dark underline"
                >
                  {a.posting.title} at {a.posting.company}
                </Link>
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
        )}
        <Link
          to="/auto-apply/applications"
          className="text-sm text-accent-dark underline"
        >
          See all applications
        </Link>
      </Section>

      <Section id="today-h" title="Today">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {d.usage && (
            <>
              <div>
                <dt className="text-muted">Applications today</dt>
                <dd>
                  {d.usage.applications_used} of {d.usage.applications_cap}
                </dd>
              </div>
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
