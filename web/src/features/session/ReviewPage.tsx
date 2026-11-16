import { Link, useParams } from "react-router-dom";

import { ApiError, API_BASE_URL } from "../../api/client";
import { useSessionDetail } from "../../api/hooks";

/** Minimal review for M3: the saved transcript with each outline beside its question, and a
 *  download. Scores and the gap finder arrive in M4. */
export function ReviewPage() {
  const { id = "" } = useParams();
  const { data, isPending, error } = useSessionDetail(id);
  if (isPending) return <p className="p-8">Loading…</p>;
  if (error) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <main className="p-8">
        <p>
          {missing
            ? "That session was not found."
            : "Couldn't load this session."}
        </p>
        <Link to="/" className="text-blue-700 underline">
          Back to the dashboard
        </Link>
      </main>
    );
  }
  const outlineFor = (uttId: string, text: string) =>
    data.suggestions.find((s) => s.utterance_id === uttId) ??
    data.suggestions.find(
      (s) => s.utterance_id === null && s.question_text === text,
    );
  const typed = data.suggestions.filter(
    (s) =>
      s.utterance_id === null &&
      !data.utterances.some((u) => u.text === s.question_text),
  );

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Session review</h1>
      <p className="text-sm text-gray-600">
        {new Date(data.started_at).toLocaleString()} · {data.utterances.length}{" "}
        lines · {data.suggestions.length} outlines
      </p>
      <a
        href={`${API_BASE_URL}/api/sessions/${id}/transcript.txt`}
        className="inline-block rounded border px-3 py-2"
      >
        Download transcript
      </a>
      <ol className="space-y-3">
        {data.utterances.map((u) => {
          const s = outlineFor(u.id, u.text);
          return (
            <li key={u.id} className="rounded border p-3">
              <p>
                <strong>{u.speaker === "you" ? "You" : "Partner"}:</strong>{" "}
                {u.text}
              </p>
              {s && (
                <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-2 text-sm">
                  {s.output_text}
                </pre>
              )}
            </li>
          );
        })}
        {typed.map((s) => (
          <li key={s.id} className="rounded border p-3">
            <p>
              <strong>Typed:</strong> {s.question_text}
            </p>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-2 text-sm">
              {s.output_text}
            </pre>
          </li>
        ))}
      </ol>
    </main>
  );
}
