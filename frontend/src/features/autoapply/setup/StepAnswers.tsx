import { useEffect } from "react";

import { useAnswers } from "../api";
import { Switch } from "./controls";

export const QUICK: { field: string; question: string; placeholder: string }[] =
  [
    {
      field: "notice_period",
      question: "What is your notice period?",
      placeholder: "e.g. Two weeks",
    },
    {
      field: "work_authorization",
      question: "Are you authorised to work in this country?",
      placeholder: "e.g. Yes, citizen",
    },
    {
      field: "sponsorship",
      question: "Do you need visa sponsorship?",
      placeholder: "e.g. No",
    },
    {
      field: "salary_expectation",
      question: "What are your salary expectations?",
      placeholder: "e.g. 90,000 USD a year",
    },
    {
      field: "relocation",
      question: "Are you willing to relocate?",
      placeholder: "e.g. Within Nigeria only",
    },
  ];

export type AnswerDraft = Record<string, { value: string; reusable: boolean }>;

/** Step 6: the questions every employer asks, answered once. */
export function StepAnswers({
  drafts,
  setDrafts,
}: {
  drafts: AnswerDraft;
  setDrafts: (d: AnswerDraft) => void;
}) {
  const saved = useAnswers();
  // start from what was saved before, once
  useEffect(() => {
    if (!saved.data) return;
    setDrafts(
      Object.fromEntries(
        QUICK.map((q) => {
          const old = saved.data.find((a) => a.field === q.field);
          return [
            q.field,
            drafts[q.field] ?? {
              value: old?.value ?? "",
              reusable: old?.reusable ?? true,
            },
          ];
        }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.data]);
  const set = (
    field: string,
    patch: Partial<{ value: string; reusable: boolean }>,
  ) =>
    setDrafts({
      ...drafts,
      [field]: {
        ...(drafts[field] ?? { value: "", reusable: true }),
        ...patch,
      },
    });
  return (
    <div className="space-y-4">
      <p className="rounded-2xl bg-accent-soft p-4 text-sm">
        Answer once and we reuse it. Anything you leave blank is simply asked
        when a job needs it. Declarations, such as a right-to-work statement,
        are always yours to make on each application.
      </p>
      {QUICK.map((q) => {
        const a = drafts[q.field] ?? { value: "", reusable: true };
        return (
          <div key={q.field} className="rounded-2xl bg-canvas p-4">
            <label htmlFor={`qa-${q.field}`} className="block font-medium">
              {q.question}
            </label>
            <input
              id={`qa-${q.field}`}
              className="input mt-2 w-full !bg-surface"
              value={a.value}
              onChange={(e) => set(q.field, { value: e.target.value })}
              placeholder={q.placeholder}
              maxLength={300}
            />
            <div className="mt-1 flex items-center gap-3">
              <Switch
                checked={a.reusable}
                onChange={(v) => set(q.field, { reusable: v })}
                label={`Reuse my answer to: ${q.question}`}
              />
              <span className="text-sm text-muted">Reuse this answer</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
