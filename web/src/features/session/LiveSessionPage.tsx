import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { API_BASE_URL } from "../../api/client";
import { endSessionApi, fetchAudioToken } from "../../api/hooks";
import { FeatureBoundary } from "../../ui/FeatureBoundary";
import { LiveSessionController } from "./controller";
import { type Line, type Outline, useLiveStore } from "./store";

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
}: {
  onShare: () => void;
  onEnd: () => void;
}) {
  const { status, level, problem, notice } = useLiveStore();
  const active =
    status === "listening" ||
    status === "reconnecting" ||
    status === "starting";
  return (
    <section aria-labelledby="cap-h" className="space-y-2 rounded border p-4">
      <h2 id="cap-h" className="text-lg font-medium">
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
                : "bg-gray-100"
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
        className="h-2 w-full overflow-hidden rounded bg-gray-200"
      >
        <div
          className="h-full bg-green-600 transition-[width]"
          style={{ width: `${Math.min(100, level * 400)}%` }}
        />
      </div>
      {problem && (
        <p
          role="alert"
          className="rounded border border-red-700 p-2 text-sm text-red-800"
        >
          {problem}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded border border-amber-600 bg-amber-50 p-2 text-sm"
        >
          {notice}
        </p>
      )}
      <div className="flex gap-2">
        {status !== "ended" && !active && (
          <button
            className="rounded bg-blue-700 px-3 py-2 text-white"
            onClick={onShare}
          >
            Share Meet tab
          </button>
        )}
        {status !== "ended" && (
          <button className="rounded border px-3 py-2" onClick={onEnd}>
            End session
          </button>
        )}
      </div>
      {status === "idle" && (
        <p className="text-xs text-gray-600">
          In the share window, pick your Meet tab and tick{" "}
          <strong>Also share tab audio</strong>. Keep this tab visible, or
          Chrome may slow it down.
        </p>
      )}
    </section>
  );
}

function OutlineView({
  outline,
  onRegenerate,
}: {
  outline: Outline;
  onRegenerate: () => void;
}) {
  const { blur, setBlur, patchOutline } = useLiveStore();
  const hidden = blur && !outline.revealed && outline.state !== "error";
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">
        Heard: <q>{outline.question}</q>
      </p>
      {/* aria-busy holds announcements until the outline is complete, so a screen reader is not
          interrupted on every token. */}
      <div
        aria-live="polite"
        aria-busy={outline.state === "streaming"}
        onClick={() => hidden && patchOutline({ revealed: true })}
        className={`whitespace-pre-wrap rounded border p-3 ${hidden ? "cursor-pointer select-none blur-sm" : ""}`}
        data-testid="outline"
      >
        {outline.text ||
          (outline.state === "streaming" ? (
            <span className="text-gray-500">Thinking…</span>
          ) : (
            ""
          ))}
      </div>
      {hidden && (
        <button
          className="rounded border px-2 py-1 text-sm"
          onClick={() => patchOutline({ revealed: true })}
        >
          Reveal
        </button>
      )}
      {outline.firstWordsMs !== undefined && (
        <p className="text-xs text-gray-600">
          First words in {(outline.firstWordsMs / 1000).toFixed(1)} s
        </p>
      )}
      {outline.flags.length > 0 && (
        <div className="rounded border border-amber-600 bg-amber-50 p-2 text-sm">
          Check these points. They may not be in your notes or the brief:
          <ul className="list-disc pl-5">
            {outline.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {outline.state === "error" && outline.error && (
        <p
          role="alert"
          className="rounded border border-red-700 p-2 text-sm text-red-800"
        >
          {outline.error.message} {outline.error.next_step}
        </p>
      )}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={blur}
            onChange={(e) => setBlur(e.target.checked)}
          />
          Answer-first (blur outlines)
        </label>
        {outline.state !== "streaming" && (
          <button
            className="rounded border px-2 py-1 text-sm"
            onClick={onRegenerate}
          >
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
}

function AnswerPanel({ onRegenerate }: { onRegenerate: () => void }) {
  const outline = useLiveStore((s) => s.outline);
  return (
    <section aria-labelledby="ans-h" className="space-y-2 rounded border p-4">
      <h2 id="ans-h" className="text-lg font-medium">
        Answer outline
      </h2>
      {outline ? (
        <OutlineView outline={outline} onRegenerate={onRegenerate} />
      ) : (
        <p className="text-gray-600">
          When your partner asks a question, an outline built from your notes
          appears here.
        </p>
      )}
    </section>
  );
}

function TranscriptList() {
  const lines = useLiveStore((s) => s.lines);
  const partial = useLiveStore((s) => s.partial);
  return (
    <section aria-labelledby="tr-h" className="space-y-2 rounded border p-4">
      <h2 id="tr-h" className="text-lg font-medium">
        Transcript
      </h2>
      {lines.length === 0 && !partial && (
        <p className="text-gray-600">Nothing heard yet.</p>
      )}
      <ol className="space-y-1 text-sm">
        {lines.map((l: Line) =>
          l.speaker === "gap" ? (
            <li key={l.key} className="text-gray-500">
              {l.text}
            </li>
          ) : (
            <li key={l.key}>
              <strong>{SPEAKER[l.speaker]}:</strong> {l.text}
            </li>
          ),
        )}
        {partial && (
          <li className="italic text-gray-600">
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
        className="w-full rounded border px-3 py-2"
      />
      <button
        type="submit"
        className="rounded border px-3 py-2"
        disabled={!text.trim()}
      >
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

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-6 md:grid-cols-2">
      <div className="space-y-4">
        <FeatureBoundary name="capture panel">
          <CapturePanel
            onShare={() => void controller.share()}
            onEnd={() => void controller.end()}
          />
        </FeatureBoundary>
        <FeatureBoundary name="answer panel">
          <AnswerPanel onRegenerate={() => controller.regenerate()} />
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
          <p className="space-x-3 rounded border p-3">
            <span>Session saved.</span>
            <Link to={`/sessions/${id}`} className="text-blue-700 underline">
              Review it
            </Link>
            <a
              href={`${API_BASE_URL}/api/sessions/${id}/transcript.txt`}
              className="text-blue-700 underline"
            >
              Download transcript
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
