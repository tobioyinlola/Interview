import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { apiFetch } from "../../api/client";

export type InterviewMode = "mock" | "assisted" | "standard";

export const MODES: {
  id: InterviewMode;
  title: string;
  line: string;
}[] = [
  {
    id: "mock",
    title: "Mock interview",
    line: "Practice with a friend, mentor or peer who knows the assistant is on. Real-time answers.",
  },
  {
    id: "assisted",
    title: "Authorised live assistance",
    line: "A real interview where the interviewer or organisation has said you may use real-time assistance.",
  },
  {
    id: "standard",
    title: "Standard interview",
    line: "A real interview without real-time answers: transcript, your notes, and feedback afterwards.",
  },
];

/** Always on screen during a session, and never hidden from a screen share: says plainly which
 *  mode this is and whether real-time answers are on. */
export function AssistantStatus({
  mode,
  authorizedBy,
}: {
  mode: InterviewMode;
  authorizedBy?: string | null;
}) {
  const text =
    mode === "standard"
      ? "Standard interview: real-time answers are off"
      : mode === "assisted"
        ? `Assistant on: authorised live assistance${authorizedBy ? ` (authorised by ${authorizedBy})` : ""}`
        : "Assistant on: mock interview";
  return (
    <p
      role="status"
      aria-label="Assistant status"
      data-testid="assistant-status"
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${
        mode === "standard"
          ? "bg-canvas text-ink"
          : "bg-accent-soft text-accent-dark"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${mode === "standard" ? "bg-muted" : "bg-accent"}`}
      />
      {text}
    </p>
  );
}

/** This session's mode: from the setup screen when it just started, else from the server. */
export function useSessionMode(id: string) {
  const state = useLocation().state as {
    mode?: InterviewMode;
    authorizedBy?: string | null;
  } | null;
  const [loaded, setLoaded] = useState<{
    mode?: InterviewMode;
    assist_authorized_by?: string | null;
  } | null>(null);
  useEffect(() => {
    if (state?.mode || !id) return;
    let live = true;
    apiFetch<{ mode?: InterviewMode; assist_authorized_by?: string | null }>(
      `/api/sessions/${id}`,
    )
      .then((d) => live && setLoaded(d))
      .catch(() => undefined); // unknown: treated as a mock session, the original behaviour
    return () => {
      live = false;
    };
  }, [id, state?.mode]);
  const mode: InterviewMode = state?.mode ?? loaded?.mode ?? "mock";
  const authorizedBy =
    state?.authorizedBy ?? loaded?.assist_authorized_by ?? null;
  const ref = useRef(mode);
  ref.current = mode;
  return { mode, authorizedBy, answersOff: () => ref.current === "standard" };
}

/** Shown in place of answers during a Standard Interview. */
export function AnswersOff() {
  return (
    <section className="card space-y-1" aria-label="Real-time answers off">
      <h2 className="text-lg font-semibold">No real-time answers</h2>
      <p className="text-sm text-muted">
        This is a Standard Interview. The transcript keeps going and you get
        feedback afterwards; nothing is suggested while you speak.
      </p>
    </section>
  );
}
