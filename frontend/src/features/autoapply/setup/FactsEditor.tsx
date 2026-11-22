import { useState } from "react";

import { useSaveFacts } from "../api";
import { Fail } from "../ui";

const lines = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

type Job = {
  title: string;
  company: string;
  start: string;
  end: string;
  summary: string;
};
type FactsData = {
  contact: Record<string, string>;
  links: string[];
  skills: string[];
  history: Job[];
  education: string[];
};

export function FactsEditor({
  initial,
  fromModel,
  onSaved,
}: {
  initial: FactsData;
  fromModel: boolean;
  onSaved: () => void;
}) {
  const save = useSaveFacts();
  const [d, setD] = useState<FactsData>(initial);
  const contact = (k: string, v: string) =>
    setD({ ...d, contact: { ...d.contact, [k]: v } });
  const job = (i: number, patch: Partial<Job>) =>
    setD({
      ...d,
      history: d.history.map((j, n) => (n === i ? { ...j, ...patch } : j)),
    });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ data: d, verified: true }, { onSuccess: onSaved });
      }}
    >
      {!fromModel && (
        <p className="notice-warn">
          We could only read your contact details automatically. Please add your
          work history and skills yourself.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["name", "Full name"],
            ["email", "Email address"],
            ["phone", "Phone number"],
            ["location", "Where you live"],
          ] as const
        ).map(([k, l]) => (
          <div key={k}>
            <label htmlFor={`f-${k}`} className="text-sm font-medium">
              {l}
            </label>
            <input
              id={`f-${k}`}
              className="input w-full"
              value={d.contact[k] ?? ""}
              onChange={(e) => contact(k, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div>
        <label htmlFor="f-links" className="text-sm font-medium">
          Links (one per line)
        </label>
        <textarea
          id="f-links"
          rows={2}
          className="input w-full"
          value={d.links.join("\n")}
          onChange={(e) => setD({ ...d, links: lines(e.target.value) })}
        />
      </div>
      <div>
        <label htmlFor="f-skills" className="text-sm font-medium">
          Skills (separated by commas)
        </label>
        <textarea
          id="f-skills"
          rows={2}
          className="input w-full"
          defaultValue={d.skills.join(", ")}
          onBlur={(e) => setD({ ...d, skills: lines(e.target.value) })}
        />
      </div>
      <fieldset className="min-w-0 space-y-3">
        <legend className="text-sm font-medium">Work history</legend>
        {d.history.map((j, i) => (
          <div key={i} className="space-y-2 rounded-xl bg-canvas p-3">
            <div className="grid gap-2 sm:grid-cols-4">
              {(
                [
                  ["title", "Job title"],
                  ["company", "Employer"],
                  ["start", "Started"],
                  ["end", "Ended"],
                ] as const
              ).map(([k, l]) => (
                <div key={k}>
                  <label htmlFor={`j${i}-${k}`} className="text-xs text-muted">
                    {l} (role {i + 1})
                  </label>
                  <input
                    id={`j${i}-${k}`}
                    className="input w-full"
                    value={j[k]}
                    onChange={(e) => job(i, { [k]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <label htmlFor={`j${i}-summary`} className="text-xs text-muted">
              What you did (role {i + 1})
            </label>
            <textarea
              id={`j${i}-summary`}
              rows={2}
              className="input w-full"
              value={j.summary}
              onChange={(e) => job(i, { summary: e.target.value })}
            />
            <button
              type="button"
              className="text-xs text-muted underline"
              onClick={() =>
                setD({ ...d, history: d.history.filter((_, n) => n !== i) })
              }
            >
              Remove role {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            setD({
              ...d,
              history: [
                ...d.history,
                { title: "", company: "", start: "", end: "", summary: "" },
              ],
            })
          }
        >
          Add a role
        </button>
      </fieldset>
      <div>
        <label htmlFor="f-edu" className="text-sm font-medium">
          Education and qualifications (one per line)
        </label>
        <textarea
          id="f-edu"
          rows={2}
          className="input w-full"
          value={d.education.join("\n")}
          onChange={(e) => setD({ ...d, education: lines(e.target.value) })}
        />
      </div>
      <Fail error={save.error} />
      <button className="btn-primary" disabled={save.isPending}>
        These details are right
      </button>
    </form>
  );
}
