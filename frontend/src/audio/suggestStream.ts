import { API_BASE_URL } from "../api/client";
import { SseParser } from "./sse";

export interface DoneInfo {
  suggestion_id: string;
  first_token_ms: number;
  total_ms: number;
  grounding_flags: string[];
}
export interface StreamError {
  code: string;
  message: string;
  next_step?: string;
}
export interface OutlineHandlers {
  onDelta: (text: string) => void;
  onSkip: () => void;
  onDone: (info: DoneInfo) => void;
  onError: (err: StreamError) => void;
}
export interface OutlineRequest {
  sessionId: string;
  question: string;
  utteranceIds: string[];
  regenerate?: boolean;
  signal: AbortSignal;
}

/** POST /suggest and read the response as a stream. The browser's EventSource cannot send a POST
 *  body, so this uses fetch and a stream reader. Aborting the signal closes the connection, which
 *  makes the server cancel the model call (a newer question replaces an unfinished outline). */
export async function streamOutline(
  req: OutlineRequest,
  h: OutlineHandlers,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/sessions/${req.sessionId}/suggest`, {
      method: "POST",
      credentials: "include",
      signal: req.signal,
      headers: {
        "content-type": "application/json",
        "x-requested-with": "meet-practice",
      },
      body: JSON.stringify({
        question_text: req.question,
        utterance_ids: req.utteranceIds,
        regenerate: req.regenerate ?? false,
      }),
    });
  } catch (e) {
    if (req.signal.aborted) return;
    h.onError({
      code: "network",
      message: "Couldn't reach the server.",
      next_step: "Ask again.",
    });
    void e;
    return;
  }
  if (!res.ok || !res.body) {
    let message = "The answer could not be started.";
    try {
      message = (await res.json()).error?.message ?? message;
    } catch {
      /* not JSON */
    }
    h.onError({
      code: `http_${res.status}`,
      message,
      next_step: "Try again, or type the question.",
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const { event, data } of parser.push(
        decoder.decode(value, { stream: true }),
      )) {
        if (event === "delta") h.onDelta((data as { text: string }).text);
        else if (event === "skip") h.onSkip();
        else if (event === "done") h.onDone(data as DoneInfo);
        else if (event === "error") h.onError(data as StreamError);
      }
    }
  } catch {
    if (!req.signal.aborted) {
      h.onError({
        code: "stream",
        message: "The answer stream was interrupted.",
        next_step: "Ask again.",
      });
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
