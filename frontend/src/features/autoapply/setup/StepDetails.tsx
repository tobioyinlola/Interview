import { useState } from "react";

import { useNotes } from "../../../api/hooks";
import type { AAFacts } from "../../../api/types";
import { CvPanel } from "../../notes/NotesPage";
import { useExtractFacts, useFacts } from "../api";
import { Fail, day } from "../ui";
import { FactsEditor } from "./FactsEditor";

type FactsData = {
  contact: Record<string, string>;
  links: string[];
  skills: string[];
  history: { title: string; company: string }[];
  education: string[];
};

/** Step 1: the CV, and the facts read from it, checked by the person. */
export function StepDetails() {
  const notes = useNotes();
  const facts = useFacts();
  const extract = useExtractFacts();
  const [draft, setDraft] = useState<AAFacts | null>(null);
  const [editing, setEditing] = useState(false);

  const hasCv = (notes.data?.content ?? "").trim().length > 0;
  if (notes.isPending || facts.isPending) return null;

  if (!hasCv)
    return (
      <div className="space-y-4">
        <p className="notice-warn">
          Auto-Apply works from your CV. Upload it here to carry on.
        </p>
        <CvPanel />
      </div>
    );

  const saved = facts.data;
  const confirmed =
    !!saved?.verified_at && !saved.cv_changed && !editing && !draft;
  const shown = draft ?? saved;
  const d = saved?.data as unknown as FactsData | undefined;

  if (confirmed && d)
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-emerald-50 p-4">
          <p role="status" className="font-medium text-emerald-900">
            ✓ Your details are confirmed ({day(saved?.verified_at)})
          </p>
          <p className="mt-1 text-sm text-emerald-900/80">
            Only what you confirmed is ever sent to an employer.
          </p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            ["Name", d.contact.name],
            ["Email", d.contact.email],
            ["Phone", d.contact.phone],
            ["Where you live", d.contact.location],
            [
              "Work history",
              `${d.history.length} role${d.history.length === 1 ? "" : "s"}`,
            ],
            ["Skills", d.skills.slice(0, 6).join(", ") || "None added"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-canvas p-3">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="truncate font-medium">{v || "Not given"}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setEditing(true)}
        >
          Edit my details
        </button>
      </div>
    );

  return (
    <div className="space-y-4">
      {saved?.cv_changed && !draft && (
        <p className="notice-warn">
          Your CV has changed since you confirmed these details. Read it again
          to check.
        </p>
      )}
      <Fail error={extract.error} />
      {!shown && (
        <div className="rounded-2xl bg-accent-soft p-5">
          <p className="font-medium">We will read your CV for you.</p>
          <p className="mt-1 text-sm text-muted">
            You will see exactly what we found and can fix anything before it is
            used.
          </p>
        </div>
      )}
      {(!shown || saved?.cv_changed || editing) && (
        <button
          type="button"
          className="btn-primary"
          disabled={extract.isPending}
          onClick={() =>
            extract.mutate(undefined, {
              onSuccess: (r) => {
                setDraft(r);
                setEditing(false);
              },
            })
          }
        >
          {extract.isPending
            ? "Reading your CV…"
            : saved
              ? "Read my CV again"
              : "Read my CV"}
        </button>
      )}
      {shown && (
        <FactsEditor
          key={draft ? "draft" : `v${saved?.version}-${editing}`}
          initial={shown.data as never}
          fromModel={shown.from_model ?? true}
          onSaved={() => {
            setDraft(null);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
