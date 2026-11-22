import { useState } from "react";
import { Link } from "react-router-dom";

import { useCampaignActions, useDashboard, useDisclosure } from "../api";
import { Fail } from "../ui";
import type { Draft, StepId } from "./draft";

const label = (v: string) => v.replace("_", " ");
const list = (v: string[]) => (v.length ? v.join(", ") : "Anything");
const must = (v: boolean) => (v ? "must" : "nice to have");

function Card({
  title,
  edit,
  onEdit,
  children,
}: {
  title: string;
  edit: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-2xl bg-canvas p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          aria-label={edit}
          className="tap rounded-full px-3 text-sm text-accent-dark hover:bg-accent-soft"
        >
          Edit
        </button>
      </div>
      <div className="mt-2 space-y-1 text-sm">{children}</div>
    </section>
  );
}

/** Step 7: everything in one place, then start. */
export function StepReview({
  d,
  goTo,
  navigate,
}: {
  d: Draft;
  goTo: (s: StepId) => void;
  navigate: (to: string) => void;
}) {
  const disc = useDisclosure();
  const dash = useDashboard();
  const { enable, pause, resume } = useCampaignActions();
  const [agree, setAgree] = useState(false);
  const state = dash.data?.campaign.state ?? "none";
  const live = state === "active" || state === "paused";
  const ways = [
    d.channels.form && "employers' forms",
    d.channels.email && "email",
    d.channels.outreach && "notes to hiring contacts",
  ].filter(Boolean);
  const problems = disc.data?.problems ?? [];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card
          title="What you want"
          edit="Edit what you want"
          onEdit={() => goTo("role")}
        >
          <p>
            <b>Roles:</b> {list(d.roles)} ({must(d.rolesReq)})
          </p>
          <p>
            <b>Places:</b> {list(d.locations)} ({must(d.locationsReq)})
          </p>
          <p>
            <b>Style:</b> {list(d.arrangement.map(label))}
          </p>
        </Card>
        <Card
          title="Nice to have"
          edit="Edit preferences"
          onEdit={() => goTo("preferences")}
        >
          <p>
            <b>Seniority:</b> {list(d.seniority.map(label))}
          </p>
          <p>
            <b>Work type:</b> {list(d.contract.map(label))}
          </p>
          <p>
            <b>Pay floor:</b>{" "}
            {d.salaryFloor
              ? `${d.salaryFloor} ${d.currency} per ${d.period} (${must(d.salaryReq)})`
              : "Not set"}
          </p>
        </Card>
        <Card
          title="Schedule"
          edit="Edit schedule"
          onEdit={() => goTo("schedule")}
        >
          <p>
            Up to <b>{d.cap}</b> a day, for 30 days.
          </p>
          <p>
            {d.anyHours
              ? "At any time of day"
              : `Between hours ${d.start} and ${d.end}`}
            , {d.timezone.replace(/_/g, " ")}.
          </p>
        </Card>
        <Card
          title="How to apply"
          edit="Edit how to apply"
          onEdit={() => goTo("apply")}
        >
          <p>{ways.length ? ways.join(", ") : "Nothing chosen yet"}.</p>
          <p>Email used: {disc.data?.mailbox ?? "none"}.</p>
        </Card>
      </div>

      <div className="rounded-2xl bg-accent-soft p-4 text-sm">
        <p className="font-semibold">What will be shared with employers</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {(disc.data?.shared ?? []).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>

      {problems.length > 0 && (
        <ul className="notice-warn list-disc pl-6">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {live ? (
        <div className="space-y-3 rounded-2xl bg-emerald-50 p-5">
          <p role="status" className="font-semibold text-emerald-900">
            🎉 Auto-Apply is {state === "paused" ? "paused" : "running"}: day{" "}
            {dash.data?.campaign.day} of 30.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/auto-apply" className="btn-primary">
              Go to Auto-Apply
            </Link>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                state === "paused" ? resume.mutate() : pause.mutate()
              }
            >
              {state === "paused" ? "Resume Auto-Apply" : "Pause Auto-Apply"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="check items-start py-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <span>
              I agree that InterviewMeet may apply to jobs for me and write to
              employers from my email, using only details I confirmed. I can
              pause or stop at any time.
            </span>
          </label>
          <Fail error={enable.error} />
          <button
            type="button"
            className="btn-primary btn-lg w-full sm:w-auto"
            disabled={
              !agree || problems.length > 0 || enable.isPending || !disc.data
            }
            onClick={() =>
              disc.data &&
              enable.mutate(disc.data.policy_version, {
                onSuccess: () => navigate("/auto-apply"),
              })
            }
          >
            {state === "ended" ? "Start another 30 days" : "Start Auto-Apply"}
          </button>
        </>
      )}
    </div>
  );
}
