import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { useMe } from "../../api/hooks";
import { Loading } from "../../ui/Loading";
import { useMailbox } from "../autoapply/api";
import { Segmented } from "../autoapply/setup/controls";
import {
  useHuntDelivery,
  useHuntSettings,
  useHuntTemplate,
  type HuntSettings,
  type HuntTarget,
  useHuntTargets,
  useRequestOutreachAccess,
} from "./api";
import { OutreachRow, StartupCard } from "./Cards";
import { StartupHero } from "./Connect";
import { Setup } from "./Setup";
import { Emails } from "./Emails";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-surface p-3 shadow-card sm:p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
    </div>
  );
}

type Tab = "review" | "sent" | "emails" | "setup";

/** The notes that are no longer waiting for review, grouped so each startup contact is one row: its
 *  first email and, when there is one, the follow-up. Newest first. */
function outreaches(list: HuntTarget[]) {
  const by = new Map<string, { first?: HuntTarget; follow?: HuntTarget }>();
  for (const t of list) {
    const k = `${t.startup}|${t.contact}`;
    const g = by.get(k) ?? {};
    if (t.step === 2) g.follow = t;
    else g.first = t;
    by.set(k, g);
  }
  const rows: { first: HuntTarget; follow?: HuntTarget }[] = [];
  for (const g of by.values()) {
    // a follow-up with no first email left in this list is shown on its own
    const first = g.first ?? g.follow;
    if (first) rows.push({ first, follow: g.first ? g.follow : undefined });
  }
  const at = (r: { first: HuntTarget; follow?: HuntTarget }) =>
    Date.parse((r.follow ?? r.first).sent_at ?? "") || 0;
  return rows.sort((a, b) => at(b) - at(a));
}

/** Approved notes that are not going out, and why, with where to fix it. Never shown when nothing
 *  is waiting or nothing is in the way. */
function WhyWaiting({ onSetup }: { onSetup: () => void }) {
  const d = useHuntDelivery();
  if (!d.data || d.data.approved === 0 || d.data.blockers.length === 0)
    return null;
  const n = d.data.approved;
  return (
    <section
      role="status"
      aria-label="Why your notes are waiting"
      className="space-y-2 rounded-2xl bg-amber-50 p-4 text-amber-950"
    >
      <p className="font-semibold">
        {n === 1 ? "1 approved note is" : `${n} approved notes are`} not going
        out yet
      </p>
      <ul className="space-y-2 text-sm">
        {d.data.blockers.map((b) => (
          <li key={b.code}>
            {b.text}{" "}
            {b.where === "email" && (
              <Link
                to="/settings/email?next=/startups"
                className="font-medium underline"
              >
                Open Settings
              </Link>
            )}
            {b.where === "setup" && (
              <button
                type="button"
                className="font-medium underline"
                onClick={onSetup}
              >
                Open Set up
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StartupsBoard() {
  const settings = useHuntSettings();
  const template = useHuntTemplate();
  const targets = useHuntTargets();
  const [params] = useSearchParams();
  const asked = params.get("tab");
  const [picked, setPicked] = useState<Tab | null>(
    asked === "emails" ? "emails" : null,
  );
  if (settings.isPending) return <Loading label="Loading startups" />;
  if (settings.isError || !settings.data)
    return (
      <main className="page-narrow">
        <p role="alert" className="notice-error">
          Startups could not be loaded. Try again in a moment.
        </p>
      </main>
    );
  const s = settings.data;
  const list = targets.data ?? [];
  const waiting = list.filter((t) => t.status === "drafted");
  const done = list.filter((t) => t.status !== "drafted");
  const sent = list.filter((t) =>
    ["sent", "replied", "declined"].includes(t.status),
  );
  const setupNeeded = !s.enabled || s.ready.length > 0;
  const tab: Tab = picked ?? (setupNeeded ? "setup" : "review");

  return (
    <main className="page-narrow space-y-5">
      <StartupHero />
      {s.mailbox && (
        <p className="text-sm text-muted">
          Pitches go from <span className="font-medium">{s.mailbox}</span>.{" "}
          <Link to="/settings/email" className="text-accent-dark underline">
            Change email
          </Link>
        </p>
      )}

      <WhyWaiting onSetup={() => setPicked("setup")} />

      {s.paused && (
        <p role="status" className="notice-info">
          Auto-Apply is paused, so startup pitches are paused too. Resume it on
          the Jobs tab.
        </p>
      )}

      <dl className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="At a glance">
        <Stat label="Waiting for you" value={waiting.length} />
        <Stat label="Sent" value={sent.length} />
        <Stat
          label="Replies"
          value={list.filter((t) => t.status === "replied").length}
        />
      </dl>

      <Segmented<Tab>
        label="Startups"
        value={tab}
        onChange={setPicked}
        className="w-full sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none"
        options={[
          {
            value: "review",
            label: waiting.length ? `Review (${waiting.length})` : "Review",
          },
          { value: "sent", label: "Sent" },
          { value: "emails", label: "Emails" },
          { value: "setup", label: setupNeeded ? "Set up •" : "Set up" },
        ]}
      />

      {tab === "setup" && (
        <Setup
          s={s}
          key={settings.dataUpdatedAt}
          onDone={() => setPicked("review")}
        />
      )}

      {tab === "emails" && <EmailsTab q={template} s={s} />}

      {tab === "review" &&
        (waiting.length === 0 ? (
          <section className="card space-y-2 text-center">
            <p className="font-medium">
              {setupNeeded
                ? "Finish setting up first."
                : "Nothing to review yet."}
            </p>
            <p className="text-sm text-muted">
              {setupNeeded
                ? "A minute of setup, then startups that fit appear here."
                : "New startups that fit you appear here as they are researched."}
            </p>
            {setupNeeded && (
              <button
                className="btn-primary mx-auto"
                onClick={() => setPicked("setup")}
              >
                Set up
              </button>
            )}
          </section>
        ) : (
          <ul className="space-y-4">
            {waiting.map((t) => (
              <StartupCard key={t.id} t={t} />
            ))}
          </ul>
        ))}

      {tab === "sent" &&
        (done.length === 0 ? (
          <section className="card text-center text-muted">
            Pitches you send, and anything you skip, are kept here.
          </section>
        ) : (
          <ul className="space-y-3">
            {outreaches(done).map((o) => (
              <OutreachRow
                key={o.first.id}
                first={o.first}
                follow={o.follow}
                days={template.data?.follow_up_days ?? 5}
                followOn={template.data?.follow_up_enabled ?? true}
              />
            ))}
          </ul>
        ))}
    </main>
  );
}

/** Not invited yet: say what this is and let them ask. */
function RequestAccess({ requested }: { requested: boolean }) {
  const ask = useRequestOutreachAccess();
  const waiting = requested || ask.isSuccess;
  return (
    <main className="page-narrow space-y-5">
      <StartupHero />
      <section className="card space-y-3" aria-label="Startup outreach access">
        <h2 className="text-lg font-semibold">
          {waiting ? "Your request is in" : "Startup outreach is by invitation"}
        </h2>
        <p className="text-muted">
          {waiting
            ? "We'll switch it on soon."
            : "Ask and we'll switch it on for you."}
        </p>
        {!waiting && (
          <button
            type="button"
            className="btn-primary"
            disabled={ask.isPending}
            onClick={() => ask.mutate()}
          >
            {ask.isPending ? "Sending…" : "Request access"}
          </button>
        )}
        {ask.isError && (
          <p role="alert" className="notice-error">
            Could not send your request. Try again in a moment.
          </p>
        )}
      </section>
    </main>
  );
}

export function StartupsPage() {
  const { data: me, isPending } = useMe();
  const box = useMailbox();
  if (isPending) return <Loading label="Loading startups" />;
  if (me?.outreach_access !== "active")
    return <RequestAccess requested={me?.outreach_access === "requested"} />;
  if (box.isPending) return <Loading label="Loading startups" />;
  // Nothing is sent from a stranger's address, and the email connection lives in Settings: send
  // them there, and bring them back here once it is connected.
  if (box.data && !box.data.connected)
    return <Navigate to="/settings/email?next=/startups" replace />;
  return <StartupsBoard />;
}

function EmailsTab({
  q,
  s,
}: {
  q: ReturnType<typeof useHuntTemplate>;
  s: HuntSettings;
}) {
  if (q.isPending) return <Loading label="Loading your emails" />;
  if (q.isError || !q.data)
    return (
      <p role="alert" className="notice-error">
        Your emails could not be loaded. Try again in a moment.
      </p>
    );
  return <Emails t={q.data} s={s} />;
}
