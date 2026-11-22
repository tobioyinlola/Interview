import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAdminUser, useGrantCredits } from "./api";
import { Empty, Failed, Loading, Stat, num, when } from "./ui";

/** One account: who they are, what they have done, and a way to give them free interviews. */
export function UserPage() {
  const { id = "" } = useParams();
  const q = useAdminUser(id);
  const grant = useGrantCredits(id);
  const [count, setCount] = useState(1);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [done, setDone] = useState<string | null>(null);

  if (q.isPending) return <Loading what="this person" />;
  if (q.isError) return <Failed what="this person" />;
  const d = q.data;
  const u = d.user;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    grant.mutate(
      { count, reason, notify },
      {
        onSuccess: () => {
          setDone(
            `Added ${count} free ${count === 1 ? "interview" : "interviews"}${notify ? " and emailed them" : ""}.`,
          );
          setReason("");
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <p>
        <Link to="/admin/users" className="text-sm text-accent-dark underline">
          ← All users
        </Link>
      </p>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {u.full_name || u.email}
        </h1>
        <p className="text-sm text-muted">
          {u.email} · joined {when(u.created_at)} · last active{" "}
          {when(u.last_active_at)}
          {u.is_admin && " · admin"}
        </p>
      </div>

      <dl
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="Account summary"
      >
        <Stat label="Interviews" value={num(u.sessions)} />
        <Stat label="Companies" value={num(u.companies)} />
        <Stat label="CV uploaded" value={u.has_cv ? "Yes" : "No"} />
        <Stat label="Onboarded" value={u.onboarded ? "Yes" : "No"} />
        <Stat
          label="Interviews available"
          value={num(u.credits_available)}
          hint={`${d.credits.used} used`}
        />
        <Stat
          label="Invited friends"
          value={num(d.invited)}
          hint={d.held ? `${d.held} held` : undefined}
        />
        <Stat
          label="Emails sent"
          value={num(d.emails_sent)}
          hint={d.emails_failed ? `${d.emails_failed} failed` : undefined}
        />
        <Stat
          label="Came from"
          value={
            [u.signup_method, u.utm_source].filter(Boolean).join(" · ") || "–"
          }
          hint={d.referred_by ? `invited by ${d.referred_by}` : undefined}
        />
      </dl>

      <section aria-labelledby="credits-h" className="card space-y-3">
        <h2 id="credits-h" className="text-lg font-semibold">
          Free interviews
        </h2>
        <p className="text-sm text-muted">
          Available now: {d.credits.trial} free trial, {d.credits.gifted} from
          the team, {d.credits.referral} from inviting friends, {d.credits.paid}{" "}
          paid.
        </p>
        <form
          onSubmit={submit}
          className="space-y-3"
          aria-label="Give free interviews"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="g-count" className="block text-sm font-medium">
                How many
              </label>
              <input
                id="g-count"
                type="number"
                min={1}
                max={10}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="input mt-1 w-24"
              />
            </div>
            <div className="min-w-[14rem] flex-1">
              <label htmlFor="g-reason" className="block text-sm font-medium">
                Reason{" "}
                <span className="font-normal text-muted">
                  (they will see it)
                </span>
              </label>
              <input
                id="g-reason"
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input mt-1 w-full"
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={grant.isPending || count < 1 || count > 10}
            >
              {grant.isPending ? "Adding…" : "Give free interviews"}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="h-5 w-5 accent-accent"
            />
            Email them to say so
          </label>
        </form>
        {done && (
          <p
            role="status"
            className="rounded-xl bg-accent-soft p-3 text-sm text-accent-dark"
          >
            {done}
          </p>
        )}
        {grant.isError && (
          <p role="alert" className="notice-error">
            {grant.error.message}
          </p>
        )}
      </section>

      <section aria-labelledby="tl-h" className="space-y-2">
        <h2 id="tl-h" className="text-lg font-semibold">
          Activity
        </h2>
        {d.timeline.length === 0 ? (
          <Empty>Nothing recorded for this person yet.</Empty>
        ) : (
          <ol className="list-card">
            {d.timeline.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm"
              >
                <span>
                  <span className="font-medium">{t.label}</span>
                  {t.detail && (
                    <span className="text-muted"> · {t.detail}</span>
                  )}
                </span>
                <time dateTime={t.at} className="text-xs text-muted">
                  {when(t.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
