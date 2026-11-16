import { streamOutline } from "./suggestStream";

const enc = new TextEncoder();
function sseResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream({
    start(c) {
      chunks.forEach((x) => c.enqueue(enc.encode(x)));
      c.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}
const handlers = () => ({
  onDelta: vi.fn(),
  onSkip: vi.fn(),
  onDone: vi.fn(),
  onError: vi.fn(),
});
const req = (signal = new AbortController().signal) => ({
  sessionId: "s1",
  question: "Why us?",
  utteranceIds: ["u1"],
  signal,
});
afterEach(() => vi.unstubAllGlobals());

describe("streamOutline", () => {
  it("posts the question with credentials and the CSRF header, and streams the outline", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'event: delta\ndata: {"text":"TYPE: "}\n\nevent: del',
          'ta\ndata: {"text":"company"}\n\n',
          'event: done\ndata: {"suggestion_id":"x","first_token_ms":900,"total_ms":2000,"grounding_flags":[]}\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const h = handlers();
    await streamOutline({ ...req(), regenerate: true }, h);

    expect(h.onDelta.mock.calls.map((c) => c[0])).toEqual([
      "TYPE: ",
      "company",
    ]);
    expect(h.onDone).toHaveBeenCalledWith(
      expect.objectContaining({ suggestion_id: "x" }),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/sessions/s1/suggest");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("x-requested-with")).toBe(
      "meet-practice",
    );
    expect(JSON.parse(init.body)).toEqual({
      question_text: "Why us?",
      utterance_ids: ["u1"],
      regenerate: true,
    });
  });

  it("reports skip and server error events", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            "event: skip\ndata: {}\n\n",
            'event: error\ndata: {"code":"answer_unavailable","message":"m","next_step":"n"}\n\n',
          ]),
        ),
    );
    const h = handlers();
    await streamOutline(req(), h);
    expect(h.onSkip).toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledWith({
      code: "answer_unavailable",
      message: "m",
      next_step: "n",
    });
  });

  it("turns an HTTP error into a plain message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "session_not_found", message: "Session not found." },
          }),
          {
            status: 404,
          },
        ),
      ),
    );
    const h = handlers();
    await streamOutline(req(), h);
    expect(h.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "http_404",
        message: "Session not found.",
      }),
    );
  });

  it("reports a network failure but stays silent when the request was aborted on purpose", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const h = handlers();
    await streamOutline(req(), h);
    expect(h.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "network" }),
    );

    const ctl = new AbortController();
    ctl.abort();
    const h2 = handlers();
    await streamOutline(req(ctl.signal), h2);
    expect(h2.onError).not.toHaveBeenCalled();
  });

  it("an aborted stream (a newer question arrived) produces no error and no more text", async () => {
    const ctl = new AbortController();
    let enqueue!: (s: string) => void;
    const body = new ReadableStream({
      start(c) {
        enqueue = (s) => c.enqueue(enc.encode(s));
      },
      cancel() {},
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const h = handlers();
    const p = streamOutline(req(ctl.signal), h);
    await new Promise((r) => setTimeout(r, 10));
    enqueue('event: delta\ndata: {"text":"one"}\n\n');
    await new Promise((r) => setTimeout(r, 10));
    ctl.abort();
    await Promise.race([p, new Promise((r) => setTimeout(r, 200))]);
    expect(h.onDelta).toHaveBeenCalledTimes(1);
    expect(h.onError).not.toHaveBeenCalled();
  });
});
