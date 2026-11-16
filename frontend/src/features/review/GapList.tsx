import { Link } from "react-router-dom";

import type { Gap } from "../../api/types";

/** Where the notes or the brief had nothing to offer, with what to add. */
export function GapList({ gaps }: { gaps: Gap[] }) {
  if (gaps.length === 0) {
    return (
      <p className="text-muted">
        No gaps found: every outline had a matching note or brief fact.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {gaps.map((g) => (
        <li key={`${g.kind}-${g.type}`} className="notice-warn">
          <p className="font-medium">
            {g.kind === "experience"
              ? `No matching story for ${g.type} questions`
              : "Company questions without brief facts"}
          </p>
          <ul className="list-disc pl-5 text-sm">
            {g.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p className="mt-1 text-sm">{g.hint}</p>
          <Link
            to={g.kind === "experience" ? "/notes" : "/companies"}
            className="mt-1 inline-block text-sm text-accent-dark underline"
          >
            {g.kind === "experience" ? "Add a note" : "Open companies"}
          </Link>
        </li>
      ))}
    </ul>
  );
}
