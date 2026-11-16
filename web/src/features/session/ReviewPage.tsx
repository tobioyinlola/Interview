import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { API_BASE_URL, ApiError } from "../../api/client";
import {
  useDeleteSession,
  useScoreSession,
  useSessionDetail,
} from "../../api/hooks";
import { GapList } from "../review/GapList";
import { ScoreCards } from "../review/ScoreCards";
import { formatWhen } from "../review/format";

const RATING = { up: "Marked useful", down: "Marked not useful" } as const;

/** Replay a finished session: transcript with each outline beside its question, answer scores
 *  with fixes, the gap finder, and a download. */
export function ReviewPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, isPending, error } = useSessionDetail(id);
  const score = useScoreSession(id);
  const del = useDeleteSession();
  const [confirming, setConfirming] = useState(false);

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
        <Link to="/sessions" className="text-blue-700 underline">
          Back to sessions
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
  const running = data.scoring_status === "running";
  const ended = data.status !== "active";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link to="/sessions" className="text-sm text-blue-700 underline">
          ← Sessions
        </Link>
        <h1 className="text-2xl font-semibold">Session review</h1>
        <p className="text-sm text-gray-600">
          {formatWhen(data.started_at)} · {data.utterances.length} lines ·{" "}
          {data.suggestions.length} outlines
        </p>
        <div className="mt-2 flex gap-2">
          <a
            href={`${API_BASE_URL}/api/sessions/${id}/transcript.txt`}
            className="rounded border px-3 py-2"
          >
            Download transcript
          </a>
          {!ended && (
            <Link to={`/session/${id}`} className="rounded border px-3 py-2">
              Back to the live session
            </Link>
          )}
        </div>
      </div>

      <section aria-labelledby="scores-h" className="space-y-2">
        <h2 id="scores-h" className="text-xl font-semibold">
          Answer scores
        </h2>
        {ended && (
          <button
            className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50"
            disabled={running || score.isPending}
            onClick={() => score.mutate()}
          >
            {data.scores.length > 0 ? "Score again" : "Score my answers"}
          </button>
        )}
        {!ended && (
          <p className="text-gray-600">
            End the session to score your answers.
          </p>
        )}
        {score.isError && (
          <p role="alert" className="text-sm text-red-800">
            {score.error.message}
          </p>
        )}
        {running && (
          <p role="status" className="text-gray-700">
            Scoring your answers… you can leave this page and come back.
          </p>
        )}
        {data.scoring_status === "failed" && (
          <p role="alert" className="text-red-800">
            {data.scoring_error ?? "Scoring failed."} Press Score to try again.
          </p>
        )}
        {data.scoring_status === "ready" && data.scores.length === 0 && (
          <p className="text-gray-700">
            No answers to score. Turn on{" "}
            <strong>Also transcribe my microphone</strong> during the session so
            your answers are recorded.
          </p>
        )}
        {data.scores.length > 0 && <ScoreCards scores={data.scores} />}
      </section>

      <section aria-labelledby="gaps-h" className="space-y-2">
        <h2 id="gaps-h" className="text-xl font-semibold">
          Gaps in your notes and brief
        </h2>
        <GapList gaps={data.gaps} />
      </section>

      <section aria-labelledby="tr-h" className="space-y-2">
        <h2 id="tr-h" className="text-xl font-semibold">
          Transcript
        </h2>
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
                  <>
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-2 text-sm">
                      {s.output_text}
                    </pre>
                    {s.feedback && (
                      <p className="text-xs text-gray-600">
                        {RATING[s.feedback as keyof typeof RATING]}
                      </p>
                    )}
                  </>
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
      </section>

      <section aria-labelledby="del-h" className="border-t pt-4">
        <h2 id="del-h" className="sr-only">
          Delete session
        </h2>
        {confirming ? (
          <div
            role="alertdialog"
            aria-label="Confirm deletion"
            className="space-y-2 rounded border border-red-700 p-3"
          >
            <p>Delete this session with its transcript, outlines and scores?</p>
            <div className="flex gap-2">
              <button
                className="rounded bg-red-700 px-3 py-2 text-white disabled:opacity-50"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(id, { onSuccess: () => navigate("/sessions") })
                }
              >
                Yes, delete
              </button>
              <button
                className="rounded border px-3 py-2"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
            {del.isError && (
              <p role="alert" className="text-sm text-red-800">
                {del.error.message}
              </p>
            )}
          </div>
        ) : (
          <button
            className="rounded border border-red-700 px-3 py-2 text-red-700"
            onClick={() => setConfirming(true)}
          >
            Delete this session
          </button>
        )}
      </section>
    </main>
  );
}
