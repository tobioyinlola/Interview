import { useEffect, useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { endSessionApi, fetchAudioToken } from "../../api/hooks";
import { FeatureBoundary } from "../../ui/FeatureBoundary";
import { LiveSessionController } from "./controller";
import { AnswersOff, AssistantStatus, useSessionMode } from "./modes";
import {
  AnswerControls,
  AnswerPanel,
  ManualQuestion,
  TranscriptList,
} from "./LiveSessionPage";
import { useLiveStore } from "./store";
import { TranscriptLink } from "./TranscriptLink";

const STATUS = {
  idle: "Ready",
  starting: "Starting…",
  listening: "Listening",
  reconnecting: "Reconnecting",
  stopped: "Stopped",
  error: "Problem",
  ended: "Session ended",
} as const;

/** A live session on a phone. A phone cannot capture another app's sound, so it listens through its
 *  microphone (put it near the speaker the call is playing through) and shows the question as it is
 *  heard with a draft answer. A question can also be typed. The same session, transcript and review
 *  as on a computer. */
export function PhoneSessionPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const sampleRate =
    (location.state as { sampleRate?: number } | null)?.sampleRate ?? 24000;
  const { status, problem, notice, level } = useLiveStore();

  const session = useSessionMode(id);
  const controller = useMemo(
    () =>
      new LiveSessionController({
        sessionId: id,
        sampleRate,
        source: "mic",
        fetchToken: async () => (await fetchAudioToken(id)).audio_token,
        endSession: () => endSessionApi(id),
        answersOff: session.answersOff,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- answersOff reads the latest mode
    [id, sampleRate],
  );
  useEffect(() => {
    useLiveStore.getState().reset();
    return () => controller.dispose();
  }, [controller]);

  const active =
    status === "listening" ||
    status === "reconnecting" ||
    status === "starting";

  return (
    <main className="space-y-4 px-5 pb-32 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="sr-only">Live interview</h1>
      <AssistantStatus
        mode={session.mode}
        authorizedBy={session.authorizedBy}
      />

      <section
        aria-label="Listening"
        className="space-y-3 rounded-[1.75rem] bg-surface p-5 shadow-card"
      >
        <div className="flex items-center justify-between gap-3">
          <span
            role="status"
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              status === "listening"
                ? "bg-green-100 text-green-900"
                : status === "error"
                  ? "bg-red-100 text-red-900"
                  : "bg-canvas"
            }`}
          >
            {STATUS[status]}
          </span>
          <div
            role="meter"
            aria-label="Sound level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(level * 400))}
            className="h-2 w-28 overflow-hidden rounded-full bg-line"
          >
            <div
              className="h-full bg-green-600 transition-[width]"
              style={{ width: `${Math.min(100, level * 400)}%` }}
            />
          </div>
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
        {status !== "ended" &&
          (active ? (
            <button
              className="btn-secondary btn-lg w-full"
              onClick={() => void controller.end()}
            >
              End session
            </button>
          ) : (
            <>
              <button
                className="btn-primary btn-lg w-full"
                onClick={() => void controller.share()}
              >
                {status === "idle" ? "Start listening" : "Listen again"}
              </button>
              {status !== "idle" && (
                <button
                  className="btn-secondary w-full"
                  onClick={() => void controller.end()}
                >
                  End session
                </button>
              )}
            </>
          ))}
        {status === "idle" && (
          <p className="text-xs text-muted">
            Put the phone near the speaker of your call. It listens through the
            microphone and drafts an answer as each question is asked. Or type a
            question below.
          </p>
        )}
      </section>

      {session.mode === "standard" ? (
        <AnswersOff />
      ) : (
        <>
          <FeatureBoundary name="answer panel">
            <AnswerPanel onDone={() => controller.markDone()} />
          </FeatureBoundary>
          <FeatureBoundary name="answer options">
            <AnswerControls onRegenerate={() => controller.regenerate()} />
          </FeatureBoundary>
          {status !== "ended" && (
            <ManualQuestion onSubmit={(q) => controller.submitManual(q)} />
          )}
        </>
      )}

      <details className="rounded-[1.75rem] bg-surface p-5 shadow-card">
        <summary className="cursor-pointer font-semibold">Transcript</summary>
        <div className="mt-3">
          <FeatureBoundary name="transcript">
            <TranscriptList />
          </FeatureBoundary>
        </div>
      </details>

      {status === "ended" && (
        <p className="space-x-3 rounded-[1.75rem] bg-surface p-5 shadow-card">
          <span>Session saved.</span>
          <Link to={`/sessions/${id}`} className="text-accent-dark underline">
            Review it
          </Link>
          <TranscriptLink id={id} className="text-accent-dark underline" />
        </p>
      )}
    </main>
  );
}
