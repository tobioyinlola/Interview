import { API_BASE_URL, ApiError } from "../api/client";

export interface SegmentResult {
  id: string | null;
  seq: number | null;
  text: string;
}

/** Send one speech segment for per-utterance transcription (the fallback when live streaming keeps
 *  failing). The body is raw 16-bit PCM; the server transcribes it and discards the audio. */
export async function postSegment(
  sessionId: string,
  pcm: Int16Array,
  sampleRate: number,
  speaker: "partner" | "you" = "partner",
): Promise<SegmentResult> {
  const res = await fetch(
    `${API_BASE_URL}/api/sessions/${sessionId}/segment?speaker=${speaker}&sample_rate=${sampleRate}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/octet-stream",
        "x-requested-with": "meet-practice",
      },
      body: pcm.buffer.slice(
        pcm.byteOffset,
        pcm.byteOffset + pcm.byteLength,
      ) as ArrayBuffer,
    },
  );
  if (!res.ok) {
    let code = "unknown";
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(
      res.status,
      code,
      message,
      res.headers.get("x-request-id") ?? "",
    );
  }
  return (await res.json()) as SegmentResult;
}
