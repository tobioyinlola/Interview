import type { Score } from "../../api/types";

const DIMENSIONS: [keyof Score, string][] = [
  ["structure", "Structure"],
  ["specificity", "Specificity"],
  ["impact", "Impact"],
  ["relevance", "Relevance"],
  ["pace", "Pace"],
];

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24">{label}</span>
      <div
        role="meter"
        aria-label={`${label} score`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-2 flex-1 overflow-hidden rounded bg-gray-200"
      >
        <div className="h-full bg-blue-600" style={{ width: `${value}%` }} />
      </div>
      <span className="w-8 text-right tabular-nums">{value}</span>
    </div>
  );
}

/** One card per answer the user gave: five scores out of 100 and two or three fixes. */
export function ScoreCards({ scores }: { scores: Score[] }) {
  return (
    <ol className="space-y-3" aria-label="Answer scores">
      {scores.map((s, i) => (
        <li key={s.id} className="rounded border p-3">
          <div className="flex items-baseline justify-between">
            <h3 className="font-medium">Answer {i + 1}</h3>
            <p aria-label={`Overall score ${s.overall} out of 100`}>
              <span className="text-2xl font-semibold">{s.overall}</span>
              <span className="text-sm text-gray-600"> / 100</span>
            </p>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Question: <q>{s.question_text}</q>
          </p>
          <details className="mt-1 text-sm">
            <summary className="cursor-pointer">What you said</summary>
            <p className="mt-1 whitespace-pre-wrap">{s.answer_text}</p>
          </details>
          <div className="mt-2 space-y-1">
            {DIMENSIONS.map(([key, label]) => (
              <Bar key={key} label={label} value={s[key] as number} />
            ))}
          </div>
          <h4 className="mt-2 text-sm font-medium">Fixes</h4>
          <ul className="list-disc pl-5 text-sm">
            {s.fixes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
