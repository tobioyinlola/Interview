import { useState } from "react";

import { Loading } from "../../ui/Loading";
import { AutoApplyTabs } from "../autoapply/AutoApplyTabs";
import { Segmented } from "../autoapply/setup/controls";
import { useHuntSettings, useHuntTargets } from "./api";
import { HistoryRow, StartupCard } from "./Cards";
import { Setup } from "./Setup";

const HOW = [
  ["We find startups", "From accelerators' public directories."],
  ["We read their careers page", "To see if a role fits you."],
  ["We write a short pitch", "You approve it, we send it from your email."],
];

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-surface p-3 shadow-card sm:p-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
    </div>
  );
}

type Tab = "review" | "sent" | "setup";

export function StartupsPage() {
  const settings = useHuntSettings();
  const targets = useHuntTargets();
  const [picked, setPicked] = useState<Tab | null>(null);
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
      <AutoApplyTabs waiting={waiting.length} />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Startups</h1>
        <p className="text-muted">
          We read a startup&apos;s careers page and email a short pitch to
          someone who can hire you.
        </p>
      </header>

      {s.paused && (
        <p role="status" className="notice-info">
          Auto-Apply is paused, so startup pitches are paused too. Resume it on
          the Jobs tab.
        </p>
      )}

      {list.length === 0 && (
        <ol className="grid gap-3 sm:grid-cols-3" aria-label="How it works">
          {HOW.map(([title, line], i) => (
            <li key={title} className="rounded-2xl bg-surface p-4 shadow-card">
              <span className="text-sm font-semibold text-accent-dark">
                {i + 1}
              </span>
              <p className="font-medium">{title}</p>
              <p className="text-sm text-muted">{line}</p>
            </li>
          ))}
        </ol>
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
            {done.map((t) => (
              <HistoryRow key={t.id} t={t} />
            ))}
          </ul>
        ))}
    </main>
  );
}
