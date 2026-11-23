import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "../../api/client";
import { Loading } from "../../ui/Loading";
import {
  useHuntSettings,
  useHuntTargets,
  useSaveHuntSettings,
  useTargetActions,
  type HuntSettings,
  type HuntTarget,
} from "./api";

const REGIONS = [
  { id: "us", label: "United States" },
  { id: "eu", label: "Europe" },
  { id: "uk", label: "United Kingdom" },
];

const STATUS: Record<string, string> = {
  drafted: "Waiting for you",
  approved: "Approved, sending soon",
  sending: "Sending",
  sent: "Sent",
  replied: "They replied",
  declined: "They said no",
  skipped: "Skipped",
  failed: "Did not send",
};

function Settings({ s }: { s: HuntSettings }) {
  const save = useSaveHuntSettings();
  const [form, setForm] = useState({
    enabled: s.enabled,
    regions: s.regions,
    roles: s.roles.join(", "),
    pitch: s.pitch,
    daily_cap: s.daily_cap,
    auto_send: s.auto_send,
    sender_name: s.sender_name,
    postal_address: s.postal_address,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const toggleRegion = (id: string) =>
    set(
      "regions",
      form.regions.includes(id)
        ? form.regions.filter((r) => r !== id)
        : [...form.regions, id],
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      ...form,
      roles: form.roles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean),
    });
  };
  const error =
    save.error instanceof ApiError
      ? save.error.message
      : save.error
        ? "Could not save."
        : null;

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h2 className="text-lg font-semibold">Your outreach</h2>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          Roles you want, separated by commas
        </span>
        <input
          className="input w-full"
          value={form.roles}
          onChange={(e) => set("roles", e.target.value)}
          placeholder="Senior Product Manager, Head of Product"
        />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Where to look</legend>
        <div className="flex flex-wrap gap-x-5">
          {REGIONS.map((r) => (
            <label key={r.id} className="check">
              <input
                type="checkbox"
                checked={form.regions.includes(r.id)}
                onChange={() => toggleRegion(r.id)}
              />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          What you offer, in your own words
        </span>
        <textarea
          className="input w-full"
          rows={3}
          maxLength={1200}
          value={form.pitch}
          onChange={(e) => set("pitch", e.target.value)}
          placeholder="I turn messy payments problems into clear roadmaps."
        />
        <span className="block text-xs text-muted">
          Notes use only this and your confirmed CV facts. Nothing is invented.
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Name to sign with</span>
          <input
            className="input w-full"
            value={form.sender_name}
            onChange={(e) => set("sender_name", e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Postal address</span>
          <input
            className="input w-full"
            value={form.postal_address}
            onChange={(e) => set("postal_address", e.target.value)}
          />
          <span className="block text-xs text-muted">
            Required on commercial email. It goes in each note's footer.
          </span>
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          Most notes a day: {form.daily_cap}
        </span>
        <input
          type="range"
          min={1}
          max={25}
          value={form.daily_cap}
          onChange={(e) => set("daily_cap", Number(e.target.value))}
          className="w-full"
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={form.auto_send}
          onChange={(e) => set("auto_send", e.target.checked)}
        />
        Send without asking me first
      </label>
      <p className="text-xs text-muted">
        Left off, every note waits for your approval. Either way notes go from{" "}
        {s.mailbox ?? "your connected email"}, on weekdays in working hours, at
        most one follow-up after five quiet days, and never to anyone who said
        no.
      </p>
      {s.ready.length > 0 && (
        <p className="notice-info">Still to do: {s.ready.join(", ")}.</p>
      )}
      {!s.mailbox && (
        <Link to="/auto-apply/setup" className="btn-secondary">
          Connect your email
        </Link>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        Turn startup outreach on
      </label>
      {error && (
        <p role="alert" className="notice-error">
          {error}
        </p>
      )}
      <button className="btn-primary btn-lg" disabled={save.isPending}>
        {save.isPending ? "Saving" : save.isSuccess ? "Saved" : "Save"}
      </button>
    </form>
  );
}

function Note({ t }: { t: HuntTarget }) {
  const { approve, skip, edit } = useTargetActions();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const waiting = t.status === "drafted";
  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a
            href={t.website}
            target="_blank"
            rel="noreferrer"
            className="font-semibold"
          >
            {t.startup}
          </a>
          <p className="text-sm text-muted">{t.one_liner}</p>
        </div>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-dark">
          {STATUS[t.status] ?? t.status}
        </span>
      </div>
      <p className="text-sm">
        To <b>{t.contact}</b>, an address the startup published{" "}
        <a href={t.contact_source} target="_blank" rel="noreferrer">
          here
        </a>
        .
      </p>
      {t.fit_reasons.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted">
          {t.fit_reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {t.reason && <p className="text-sm text-muted">{t.reason}</p>}
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide the note" : "Read the note"}
      </button>
      {open &&
        (waiting ? (
          <div className="space-y-2">
            <input
              className="input w-full"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-label="Subject"
            />
            <textarea
              className="input w-full"
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Note"
            />
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={edit.isPending}
              onClick={() => edit.mutate({ id: t.id, subject, body })}
            >
              Save changes
            </button>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap rounded-xl bg-accent-soft p-3 text-sm">
            {t.subject}
            {"\n\n"}
            {t.body}
          </pre>
        ))}
      {waiting && (
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            disabled={approve.isPending}
            onClick={() => approve.mutate(t.id)}
          >
            Approve and send
          </button>
          <button className="btn-secondary" onClick={() => skip.mutate(t.id)}>
            Skip
          </button>
        </div>
      )}
    </li>
  );
}

export function StartupsPage() {
  const settings = useHuntSettings();
  const targets = useHuntTargets();
  if (settings.isPending) return <Loading label="Loading startup outreach" />;
  if (settings.isError || !settings.data)
    return (
      <main className="page-narrow">
        <p role="alert" className="notice-error">
          Startup outreach could not be loaded. Try again in a moment.
        </p>
      </main>
    );
  const list = targets.data ?? [];
  const waiting = list.filter((t) => t.status === "drafted");
  const rest = list.filter((t) => t.status !== "drafted");
  return (
    <main className="page-narrow space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Startup outreach</h1>
        <p className="text-muted">
          We read accelerators' public directories and each startup's own site,
          then write to an address the startup published, from your email, in
          your voice. Real notes to real people, a few a day.
        </p>
      </header>
      <Settings s={settings.data} key={settings.dataUpdatedAt} />
      <section className="space-y-3" aria-label="Notes waiting for you">
        <h2 className="text-lg font-semibold">
          Waiting for you {waiting.length > 0 && `(${waiting.length})`}
        </h2>
        {waiting.length === 0 ? (
          <p className="text-muted">
            Nothing to review yet. New matches appear here as startups are
            researched.
          </p>
        ) : (
          <ul className="space-y-3">
            {waiting.map((t) => (
              <Note key={t.id} t={t} />
            ))}
          </ul>
        )}
      </section>
      {rest.length > 0 && (
        <section className="space-y-3" aria-label="Everything else">
          <h2 className="text-lg font-semibold">History</h2>
          <ul className="space-y-3">
            {rest.map((t) => (
              <Note key={t.id} t={t} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
