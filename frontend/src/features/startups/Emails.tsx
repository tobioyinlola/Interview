import { useState } from "react";

import { ApiError } from "../../api/client";
import { Switch } from "../autoapply/setup/controls";
import {
  usePreviewTemplate,
  useSaveTemplate,
  type HuntTemplate,
  type TemplatePreview,
} from "./api";

type Row = { name: string; value: string };

const HOURS = Array.from({ length: 25 }, (_, h) => h);

/** The ISO time the server keeps, shown the way a date box wants it (the person's own clock). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The person's own emails, the details that fill them in, and when they go. */
export function Emails({ t }: { t: HuntTemplate }) {
  const save = useSaveTemplate();
  const preview = usePreviewTemplate();
  const [on, setOn] = useState(t.use_template);
  const [first, setFirst] = useState({
    subject: t.first_subject,
    body: t.first_body,
  });
  const [follow, setFollow] = useState({
    subject: t.follow_subject,
    body: t.follow_body,
  });
  const [rows, setRows] = useState<Row[]>(
    Object.entries(t.variables).map(([name, value]) => ({ name, value })),
  );
  const [followOn, setFollowOn] = useState(t.follow_up_enabled);
  const [days, setDays] = useState(t.follow_up_days);
  const [notBefore, setNotBefore] = useState(toLocalInput(t.send_not_before));
  const [from, setFrom] = useState(t.window_start);
  const [to, setTo] = useState(t.window_end);
  const [shown, setShown] = useState<{
    which: string;
    p: TemplatePreview;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const variables = () =>
    Object.fromEntries(
      rows
        .filter((r) => r.name.trim() && r.value.trim())
        .map((r) => [r.name, r.value]),
    );
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const loadStarter = () => {
    setFirst({ subject: t.starter.first_subject, body: t.starter.first_body });
    setFollow({
      subject: t.starter.follow_subject,
      body: t.starter.follow_body,
    });
    if (!rows.some((r) => r.name.toLowerCase().includes("portfolio")))
      setRows((rs) => [...rs, { name: "portfolio_link", value: "" }]);
  };

  const show = (which: "first" | "follow") => {
    const e = which === "first" ? first : follow;
    preview.mutate(
      { which, subject: e.subject, body: e.body, variables: variables() },
      { onSuccess: (p) => setShown({ which, p }) },
    );
  };

  const submit = () => {
    setError("");
    setSaved(false);
    save.mutate(
      {
        use_template: on,
        first_subject: first.subject,
        first_body: first.body,
        follow_subject: follow.subject,
        follow_body: follow.body,
        variables: variables(),
        follow_up_enabled: followOn,
        follow_up_days: days,
        send_not_before: notBefore ? new Date(notBefore).toISOString() : null,
        window_start: from,
        window_end: to,
      },
      {
        onSuccess: () => setSaved(true),
        onError: (e) =>
          setError(
            e instanceof ApiError ? e.message : "Could not save. Try again.",
          ),
      },
    );
  };

  const box = (
    label: string,
    e: { subject: string; body: string },
    set: (v: { subject: string; body: string }) => void,
    which: "first" | "follow",
  ) => (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{label}</legend>
      <label className="block space-y-1">
        <span className="text-sm text-muted">Subject</span>
        <input
          className="input w-full"
          value={e.subject}
          maxLength={300}
          onChange={(ev) => set({ ...e, subject: ev.target.value })}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-muted">Email</span>
        <textarea
          className="input w-full font-mono text-sm"
          rows={12}
          maxLength={4000}
          value={e.body}
          onChange={(ev) => set({ ...e, body: ev.target.value })}
        />
      </label>
      <button
        type="button"
        className="btn-secondary"
        disabled={preview.isPending}
        onClick={() => show(which)}
      >
        Preview this email
      </button>
      {shown?.which === which && (
        <div
          className="rounded-xl bg-canvas p-3 text-sm space-y-2"
          role="region"
          aria-label="Preview"
        >
          <p className="text-muted">
            Preview for {shown.p.company}, to a contact named Sam
          </p>
          <p className="font-medium">{shown.p.subject}</p>
          <pre className="whitespace-pre-wrap font-sans">{shown.p.body}</pre>
          {shown.p.missing.length > 0 && (
            <p role="status" className="notice-info">
              Missing details: {shown.p.missing.join(", ")}. Add them below, or
              an email that needs them is held for you instead of sent.
            </p>
          )}
        </div>
      )}
    </fieldset>
  );

  return (
    <section className="card space-y-6" aria-label="Your emails">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Your own emails
          </h2>
          <p className="text-sm text-muted">
            Write the first email and the follow-up once. Each one goes to a
            startup with its name filled in, plus your details. Your opt-out
            line and postal address are always added at the bottom.
          </p>
        </div>
        <Switch checked={on} onChange={setOn} label="Use my own emails" />
      </div>

      {!first.body.trim() && (
        <button type="button" className="btn-secondary" onClick={loadStarter}>
          Start from an example
        </button>
      )}

      <p className="text-sm text-muted">
        Put a detail in double curly brackets, like <code>{"{{company}}"}</code>
        . These are filled in for you:{" "}
        {Object.keys(t.builtin).map((k, i) => (
          <span key={k} title={t.builtin[k]}>
            {i > 0 && ", "}
            <code>{`{{${k}}}`}</code>
          </span>
        ))}
        . <code>{"{{company}}"}</code> is always the startup the email goes to.
      </p>

      {box("First email", first, setFirst, "first")}
      {box("Follow-up", follow, setFollow, "follow")}

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Your details</legend>
        <p className="text-sm text-muted">
          Anything else you use in curly brackets, such as{" "}
          <code>{"{{portfolio_link}}"}</code>, <code>{"{{phone}}"}</code> or{" "}
          <code>{"{{linkedin}}"}</code>.
        </p>
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <input
              className="input w-40"
              aria-label="Detail name"
              placeholder="portfolio_link"
              value={r.name}
              onChange={(e) => setRow(i, { name: e.target.value })}
            />
            <input
              className="input min-w-0 flex-1"
              aria-label="Detail value"
              placeholder="https://"
              value={r.value}
              onChange={(e) => setRow(i, { value: e.target.value })}
            />
            <button
              type="button"
              className="btn-secondary"
              aria-label="Remove detail"
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setRows((rs) => [...rs, { name: "", value: "" }])}
        >
          Add a detail
        </button>
        {t.unknown.length > 0 && (
          <p role="status" className="notice-info">
            Your emails use details with no value yet: {t.unknown.join(", ")}.
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">When they go</legend>
        <label className="block space-y-1">
          <span className="text-sm">Do not send the first email before</span>
          <input
            type="datetime-local"
            className="input"
            value={notBefore}
            onChange={(e) => setNotBefore(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Send on weekdays from</span>
          <select
            className="input"
            aria-label="From hour"
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
          >
            {HOURS.slice(0, 24).map((h) => (
              <option
                key={h}
                value={h}
              >{`${String(h).padStart(2, "0")}:00`}</option>
            ))}
          </select>
          <span>to</span>
          <select
            className="input"
            aria-label="To hour"
            value={to}
            onChange={(e) => setTo(Number(e.target.value))}
          >
            {HOURS.slice(1).map((h) => (
              <option
                key={h}
                value={h}
              >{`${String(h).padStart(2, "0")}:00`}</option>
            ))}
          </select>
          <span>your time</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Switch
            checked={followOn}
            onChange={setFollowOn}
            label="Send a follow-up"
          />
          <label className="flex items-center gap-2">
            <span>if there is no reply after</span>
            <input
              type="number"
              min={1}
              max={30}
              className="input w-20"
              aria-label="Days before the follow-up"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
            <span>days</span>
          </label>
        </div>
        <p className="text-sm text-muted">
          One follow-up at most, and never to anyone who has replied or asked
          you to stop.
        </p>
      </fieldset>

      {error && (
        <p role="alert" className="notice-error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="notice-info">
          Saved.
        </p>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={save.isPending}
        onClick={submit}
      >
        Save
      </button>
    </section>
  );
}
