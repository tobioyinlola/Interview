import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useParams } from "react-router-dom";

import { API_BASE_URL } from "../../api/client";
import { endSessionApi, fetchAudioToken, sendFeedback } from "../../api/hooks";
import { FeatureBoundary } from "../../ui/FeatureBoundary";
import { answerOf } from "./answerText";
import { LiveSessionController } from "./controller";
import { DesktopSyncPanel } from "./DesktopSyncPanel";
import { type Line, type Outline, useLiveStore } from "./store";
import { useFloatingPanel } from "./useFloatingPanel";

const STATUS_TEXT = {
  idle: "Not started",
  starting: "Starting…",
  listening: "Listening",
  reconnecting: "Reconnecting",
  stopped: "Stopped",
  error: "Error",
  ended: "Session ended",
} as const;

const SPEAKER = {
  partner: "Partner",
  you: "You",
  typed: "Typed",
  gap: "",
} as const;

function CapturePanel({
  onShare,
  onEnd,
  onMic,
}: {
  onShare: () => void;
  onEnd: () => void;
  onMic: (on: boolean) => void;
}) {
  const { status, level, problem, notice, mic, micProblem, micLevel, mode } =
    useLiveStore();
  const active =
    status === "listening" ||
    status === "reconnecting" ||
    status === "starting";
  return (
    <section aria-labelledby="cap-h" className="card space-y-2">
      <h2 id="cap-h" className="text-lg font-semibold">
        Capture
      </h2>
      <p>
        <span
          role="status"
          className={`rounded px-2 py-1 text-sm ${
            status === "listening"
              ? "bg-green-100"
              : status === "error"
                ? "bg-red-100"
                : "bg-canvas"
          }`}
        >
          {STATUS_TEXT[status]}
        </span>
      </p>
      <div
        role="meter"
        aria-label="Tab audio level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(level * 400))}
        className="h-2 w-full overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full bg-green-600 transition-[width]"
          style={{ width: `${Math.min(100, level * 400)}%` }}
        />
      </div>
      {problem && (
        <p role="alert" className="notice-error">
          {problem}
        </p>
      )}
      {notice && (
        <p role="status" className="notice-warn">
          {notice}
        </p>
      )}
      {mode === "segments" && (
        <p className="text-xs text-muted">
          Fallback mode: captions arrive after each pause.
        </p>
      )}
      {status !== "ended" && (
        <div className="space-y-1">
          <label className="flex min-h-[44px] items-center gap-3 text-sm">
            <input
              className="h-5 w-5 accent-accent"
              type="checkbox"
              checked={mic === "on" || mic === "starting"}
              disabled={status !== "listening" && status !== "reconnecting"}
              onChange={(e) => onMic(e.target.checked)}
            />
            Also transcribe my microphone
          </label>
          <p className="text-xs text-muted">
            Labelled &quot;You&quot; in the transcript and used for your review.
            Headphones work best, so the partner&apos;s voice is not picked up
            twice.
          </p>
          {mic === "on" && (
            <div
              role="meter"
              aria-label="Microphone level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.round(micLevel * 400))}
              className="h-2 w-full overflow-hidden rounded-full bg-line"
            >
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${Math.min(100, micLevel * 400)}%` }}
              />
            </div>
          )}
          {mic === "error" && micProblem && (
            <p role="alert" className="notice-error">
              {micProblem}
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        {status !== "ended" && !active && (
          <button className="btn-primary" onClick={onShare}>
            Share Meet tab
          </button>
        )}
        {status !== "ended" && (
          <button className="btn-secondary" onClick={onEnd}>
            End session
          </button>
        )}
      </div>
      {status === "idle" && (
        <p className="text-xs text-muted">
          In the share window, pick your Meet tab and tick{" "}
          <strong>Also share tab audio</strong>. Keep this tab visible, or
          Chrome may slow it down.
        </p>
      )}
    </section>
  );
}

function FeedbackButtons({ outline }: { outline: Outline }) {
  const patchOutline = useLiveStore((st) => st.patchOutline);
  const [failed, setFailed] = useState(false);
  const rate = (value: "up" | "down") => {
    const id = outline.suggestionId;
    if (!id) return;
    setFailed(false);
    patchOutline({ feedback: value }); // show the choice at once
    sendFeedback(id, value).catch(() => {
      patchOutline({ feedback: undefined });
      setFailed(true);
    });
  };
  return (
    <span
      className="flex items-center gap-1 text-sm"
      role="group"
      aria-label="Rate this outline"
    >
      <button
        type="button"
        aria-pressed={outline.feedback === "up"}
        aria-label="Useful"
        className={`btn-secondary btn-sm ${outline.feedback === "up" ? "bg-green-100" : ""}`}
        onClick={() => rate("up")}
      >
        👍
      </button>
      <button
        type="button"
        aria-pressed={outline.feedback === "down"}
        aria-label="Not useful"
        className={`btn-secondary btn-sm ${outline.feedback === "down" ? "bg-red-100" : ""}`}
        onClick={() => rate("down")}
      >
        👎
      </button>
      {failed && (
        <span role="alert" className="text-red-800">
          Couldn&apos;t save that.
        </span>
      )}
    </span>
  );
}

/** What the floating panel shows: the question that was asked and the answer, nothing else. */
function QuestionAnswer({ outline }: { outline: Outline }) {
  const { blur, patchOutline } = useLiveStore();
  const hidden = blur && !outline.revealed && outline.state !== "error";
  const answer = answerOf(outline.text, outline.state === "streaming");
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-muted">Question</h3>
        <p className="mt-1" data-testid="question">
          {outline.question}
        </p>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-muted">Answer</h3>
        {/* aria-busy holds announcements until the answer is complete, so a screen reader is not
            interrupted on every token. */}
        <div
          aria-live="polite"
          aria-busy={outline.state === "streaming"}
          onClick={() => hidden && patchOutline({ revealed: true })}
          className={`mt-1 whitespace-pre-wrap card !p-4 ${hidden ? "cursor-pointer select-none blur-sm" : ""}`}
          data-testid="outline"
        >
          {answer ||
            (outline.state === "streaming" ? (
              <span className="text-muted">Thinking…</span>
            ) : (
              ""
            ))}
        </div>
      </div>
      {hidden && (
        <button
          className="btn-secondary btn-sm"
          onClick={() => patchOutline({ revealed: true })}
        >
          Reveal
        </button>
      )}
      {outline.flags.length > 0 && (
        <div className="notice-warn">
          Check these points. They may not be in your CV or the brief:
          <ul className="list-disc pl-5">
            {outline.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {outline.state === "error" && outline.error && (
        <p role="alert" className="notice-error">
          {outline.error.message} {outline.error.next_step}
        </p>
      )}
    </div>
  );
}

/** Options for the answer. They stay on the page, outside the panel, so the panel stays clean. */
function AnswerControls({ onRegenerate }: { onRegenerate: () => void }) {
  const outline = useLiveStore((s) => s.outline);
  const { blur, setBlur } = useLiveStore();
  return (
    <section aria-label="Answer options" className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input
            className="h-5 w-5 accent-accent"
            type="checkbox"
            checked={blur}
            onChange={(e) => setBlur(e.target.checked)}
          />
          Answer-first (blur answers)
        </label>
        {outline?.state === "done" && outline.suggestionId && (
          <FeedbackButtons outline={outline} />
        )}
        {outline && outline.state !== "streaming" && (
          <button className="btn-secondary btn-sm" onClick={onRegenerate}>
            Regenerate
          </button>
        )}
      </div>
      {outline?.firstWordsMs !== undefined && (
        <p className="text-xs text-muted">
          First words in {(outline.firstWordsMs / 1000).toFixed(1)} s
        </p>
      )}
    </section>
  );
}

/** The question being asked right now, as it is transcribed: finished sentences, then the words still
 *  being spoken. Shown while no answer is up. */
function ListeningNow() {
  const lines = useLiveStore((s) => s.lines);
  const turnStart = useLiveStore((s) => s.turnStart);
  const partial = useLiveStore((s) => s.partial);
  const said = lines
    .slice(turnStart)
    .filter((l) => l.speaker === "partner" || l.speaker === "typed")
    .map((l) => l.text)
    .join(" ");
  return (
    <div className="space-y-1" aria-live="polite">
      <h3 className="text-sm font-semibold text-muted">Question</h3>
      {said || partial ? (
        <p data-testid="question">
          {said}
          {partial && (
            <span className="italic text-muted">
              {said ? " " : ""}
              {partial}…
            </span>
          )}
        </p>
      ) : (
        <p className="text-muted">Listening for the interviewer's question…</p>
      )}
    </div>
  );
}

/** What the interviewer said after the question that is being answered. It is shown, and never
 *  changes the answer. */
function Additions() {
  const lines = useLiveStore((s) => s.lines);
  const lockedAt = useLiveStore((s) => s.lockedAt);
  const partial = useLiveStore((s) => s.partial);
  const more = lines
    .slice(lockedAt ?? lines.length)
    .filter((l) => l.speaker === "partner");
  if (more.length === 0 && !partial) return null;
  return (
    <div aria-live="polite" className="space-y-1" data-testid="additions">
      <h3 className="text-sm font-semibold text-muted">
        The interviewer also said
      </h3>
      <ul className="space-y-1 text-sm">
        {more.map((l) => (
          <li key={l.key}>{l.text}</li>
        ))}
        {partial && <li className="italic text-muted">{partial}…</li>}
      </ul>
    </div>
  );
}

function AnswerPanel({ onDone }: { onDone: () => void }) {
  const outline = useLiveStore((s) => s.outline);
  return (
    <section aria-labelledby="ans-h" className="card space-y-3">
      <h2 id="ans-h" className="text-lg font-semibold">
        Question and answer
      </h2>
      {outline ? (
        <>
          <QuestionAnswer outline={outline} />
          <Additions />
          <div className="space-y-1">
            <button className="btn-primary w-full" onClick={onDone}>
              Done, next question
            </button>
            <p className="text-xs text-muted">
              This answer stays until you press Done.
            </p>
          </div>
        </>
      ) : (
        <ListeningNow />
      )}
    </section>
  );
}

function TranscriptList() {
  const lines = useLiveStore((s) => s.lines);
  const partial = useLiveStore((s) => s.partial);
  return (
    <section aria-labelledby="tr-h" className="card space-y-2">
      <h2 id="tr-h" className="text-lg font-semibold">
        Transcript
      </h2>
      {lines.length === 0 && !partial && (
        <p className="text-muted">Nothing heard yet.</p>
      )}
      <ol className="space-y-1 text-sm">
        {lines.map((l: Line) =>
          l.speaker === "gap" ? (
            <li key={l.key} className="text-muted">
              {l.text}
            </li>
          ) : (
            <li key={l.key}>
              <strong>{SPEAKER[l.speaker]}:</strong> {l.text}
            </li>
          ),
        )}
        {partial && (
          <li className="italic text-muted">
            <strong>Partner:</strong> {partial}…
          </li>
        )}
      </ol>
    </section>
  );
}

function ManualQuestion({ onSubmit }: { onSubmit: (q: string) => void }) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(text);
    setText("");
  };
  return (
    <form onSubmit={submit} className="flex gap-2" aria-label="Question entry">
      <label htmlFor="manual" className="sr-only">
        Type a question
      </label>
      <input
        id="manual"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a question and press Enter (to try it alone)"
        className="input w-full"
      />
      <button type="submit" className="btn-secondary" disabled={!text.trim()}>
        Ask
      </button>
    </form>
  );
}

export function LiveSessionPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const sampleRate =
    (location.state as { sampleRate?: number } | null)?.sampleRate ?? 24000;
  const status = useLiveStore((s) => s.status);
  const float = useFloatingPanel();

  const controller = useMemo(
    () =>
      new LiveSessionController({
        sessionId: id,
        sampleRate,
        fetchToken: async () => (await fetchAudioToken(id)).audio_token,
        endSession: () => endSessionApi(id),
      }),
    [id, sampleRate],
  );

  useEffect(() => {
    useLiveStore.getState().reset();
    return () => controller.dispose(); // leaving the page stops capture; the session is ended explicitly
  }, [controller]);

  const answer = <AnswerPanel onDone={() => controller.markDone()} />;

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-6 md:grid-cols-2">
      <div className="space-y-4">
        <FeatureBoundary name="capture panel">
          <CapturePanel
            onShare={() => void controller.share()}
            onEnd={() => void controller.end()}
            onMic={(on) => void controller.setMic(on)}
          />
        </FeatureBoundary>
        <FeatureBoundary name="desktop sync">
          <DesktopSyncPanel sessionId={id} ended={status === "ended"} />
        </FeatureBoundary>
        <FeatureBoundary name="answer panel">
          {float.win ? (
            <section className="card space-y-2">
              <p>The answer panel is in its own window, on top of Meet.</p>
              <button className="btn-secondary" onClick={float.close}>
                Bring it back here
              </button>
              {createPortal(
                <div className="p-3">{answer}</div>,
                float.win.document.body,
              )}
            </section>
          ) : (
            <>
              {answer}
              {float.supported && (
                <button
                  className="btn-secondary text-sm"
                  onClick={() => void float.open()}
                >
                  Float the answer panel
                </button>
              )}
            </>
          )}
        </FeatureBoundary>
        <FeatureBoundary name="answer options">
          <AnswerControls onRegenerate={() => controller.regenerate()} />
        </FeatureBoundary>
        {status !== "ended" && (
          <ManualQuestion onSubmit={(q) => controller.submitManual(q)} />
        )}
      </div>
      <div className="space-y-4">
        <FeatureBoundary name="transcript">
          <TranscriptList />
        </FeatureBoundary>
        {status === "ended" && (
          <p className="space-x-3 card !p-4">
            <span>Session saved.</span>
            <Link to={`/sessions/${id}`} className="text-accent-dark underline">
              Review it
            </Link>
            <a
              href={`${API_BASE_URL}/api/sessions/${id}/transcript.txt`}
              className="text-accent-dark underline"
            >
              Download transcript
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
