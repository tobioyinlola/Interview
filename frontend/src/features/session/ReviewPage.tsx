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
import { answerOf } from "./answerText";
import { Loading } from "../../ui/Loading";

const RATING = { up: "Marked useful", down: "Marked not useful" } as const;

/** Replay a finished session: transcript with each outline beside its question, answer scores
 *  with fixes, the gap finder, and a download. */
const SOURCE = /\[((?:note|brief)\s*:[^\]]*)\]/gi;

/** The answer that was shown for a question: the spoken answer in plain type, and where its facts
 *  came from as small labels. The model's own headings are never shown. */
function SavedAnswer({ text }: { text: string }) {
  const sources = [
    ...new Set(
      [...text.matchAll(SOURCE)].map((m) => m[1].replace(/\s+/g, " ").trim()),
    ),
  ];
  const answer = answerOf(text)
    .replace(SOURCE, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return (
    <div className="mt-3 rounded-xl bg-canvas p-3.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Suggested answer
      </p>
      <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">
        {answer || "No answer was written for this."}
      </p>
      {sources.length > 0 && (
        <ul aria-label="Sources" className="mt-2 flex flex-wrap gap-1.5">
          {sources.map((src) => (
            <li
              key={src}
              className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-accent-dark"
            >
              {src}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReviewPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, isPending, error } = useSessionDetail(id);
  const score = useScoreSession(id);
  const del = useDeleteSession();
  const [confirming, setConfirming] = useState(false);

  if (isPending) return <Loading />;
  if (error) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <main className="p-8">
        <p>
          {missing
            ? "That session was not found."
            : "Couldn't load this session."}
        </p>
        <Link to="/sessions" className="text-accent-dark underline">
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
    <main className="page-narrow">
      <div>
        <Link to="/sessions" className="text-sm text-accent-dark underline">
          ← Sessions
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Session review
        </h1>
        <p className="text-sm text-muted">
          {formatWhen(data.started_at)} · {data.utterances.length} lines ·{" "}
          {data.suggestions.length} outlines
        </p>
        <div className="mt-2 flex gap-2">
          <a
            href={`${API_BASE_URL}/api/sessions/${id}/transcript.txt`}
            className="btn-secondary"
          >
            Download transcript
          </a>
          {!ended && (
            <Link to={`/session/${id}`} className="btn-secondary">
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
            className="btn-primary"
            disabled={running || score.isPending}
            onClick={() => score.mutate()}
          >
            {data.scores.length > 0 ? "Score again" : "Score my answers"}
          </button>
        )}
        {!ended && (
          <p className="text-muted">End the session to score your answers.</p>
        )}
        {score.isError && (
          <p role="alert" className="text-sm text-red-800">
            {score.error.message}
          </p>
        )}
        {running && (
          <p role="status" className="text-muted">
            Scoring your answers… you can leave this page and come back.
          </p>
        )}
        {data.scoring_status === "failed" && (
          <p role="alert" className="text-red-800">
            {data.scoring_error ?? "Scoring failed."} Press Score to try again.
          </p>
        )}
        {data.scoring_status === "ready" && data.scores.length === 0 && (
          <p className="text-muted">
            No answers to score. Turn on{" "}
            <strong>Also transcribe my microphone</strong> during the session so
            your answers are recorded.
          </p>
        )}
        {data.scores.length > 0 && <ScoreCards scores={data.scores} />}
      </section>

      <section aria-labelledby="gaps-h" className="space-y-2">
        <h2 id="gaps-h" className="text-xl font-semibold">
          Gaps in your CV and brief
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
              <li key={u.id} className="card !p-4">
                <p>
                  <strong>{u.speaker === "you" ? "You" : "Partner"}:</strong>{" "}
                  {u.text}
                </p>
                {s && (
                  <>
                    <SavedAnswer text={s.output_text} />
                    {s.feedback && (
                      <p className="mt-2 text-xs text-muted">
                        {RATING[s.feedback as keyof typeof RATING]}
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          })}
          {typed.map((s) => (
            <li key={s.id} className="card !p-4">
              <p>
                <strong>Typed:</strong> {s.question_text}
              </p>
              <SavedAnswer text={s.output_text} />
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
            className="notice-error space-y-2"
          >
            <p>Delete this session with its transcript, outlines and scores?</p>
            <div className="flex gap-2">
              <button
                className="btn-danger"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(id, { onSuccess: () => navigate("/sessions") })
                }
              >
                Yes, delete
              </button>
              <button
                className="btn-secondary"
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
            className="btn-danger-outline"
            onClick={() => setConfirming(true)}
          >
            Delete this session
          </button>
        )}
      </section>
    </main>
  );
}
