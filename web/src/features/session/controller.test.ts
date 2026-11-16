import type { AudioSocket, SocketEvents } from "../../audio/AudioSocket";
import { CaptureError, NO_AUDIO_HELP } from "../../audio/captureTab";
import type {
  OutlineHandlers,
  OutlineRequest,
} from "../../audio/suggestStream";
import { LiveSessionController } from "./controller";
import { useLiveStore } from "./store";

const loud = (amp = 0.3) => new Int16Array(1024).fill(Math.round(amp * 32767));
const quiet = () => new Int16Array(1024);
const final = (
  id: string,
  text: string,
  speaker: "partner" | "you" = "partner",
) => ({
  id,
  seq: Number(id.replace(/\D/g, "")) || 1,
  speaker,
  text,
  ended_at: "2026-11-16T10:00:00Z",
});

class FakeSocket {
  started = false;
  stopped = false;
  frames: ArrayBuffer[] = [];
  ev!: SocketEvents;
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  sendAudio(b: ArrayBuffer) {
    this.frames.push(b);
    return true;
  }
}

interface StreamCall {
  req: OutlineRequest;
  h: OutlineHandlers;
  finish: () => void;
}

function setup(opts: { captureError?: Error } = {}) {
  useLiveStore.getState().reset();
  let t = 0;
  const sock = new FakeSocket();
  const cap = { stop: vi.fn() };
  let capCb!: { onFrame: (p: Int16Array) => void; onEnded: () => void };
  const streams: StreamCall[] = [];
  const endSession = vi.fn().mockResolvedValue({});
  const c = new LiveSessionController({
    sessionId: "sess",
    sampleRate: 24000,
    fetchToken: async () => "tok",
    endSession,
    now: () => t,
    capture: async (_rate, cb) => {
      if (opts.captureError) throw opts.captureError;
      capCb = cb;
      return cap;
    },
    makeSocket: (_o, ev) => {
      sock.ev = ev;
      return sock as unknown as AudioSocket;
    },
    stream: (req, h) =>
      new Promise<void>((resolve) => {
        streams.push({ req, h, finish: resolve });
      }),
  });
  const s = () => useLiveStore.getState();
  return {
    c,
    s,
    sock,
    cap,
    streams,
    endSession,
    at: (ms: number) => (t = ms),
    frame: (pcm: Int16Array) => capCb.onFrame(pcm),
    shareEnded: () => capCb.onEnded(),
  };
}

describe("LiveSessionController: starting", () => {
  it("explains a capture failure and does not open the socket", async () => {
    const x = setup({
      captureError: new CaptureError("no_audio", NO_AUDIO_HELP),
    });
    await x.c.share();
    expect(x.s().status).toBe("error");
    expect(x.s().problem).toBe(NO_AUDIO_HELP);
    expect(x.sock.started).toBe(false);
  });

  it("goes live only when the server says ready", async () => {
    const x = setup();
    await x.c.share();
    expect(x.sock.started).toBe(true);
    expect(x.s().status).toBe("starting");
    x.sock.ev.onState("ready");
    expect(x.s().status).toBe("listening");
  });

  it("a second share while running does nothing", async () => {
    const x = setup();
    await x.c.share();
    await x.c.share();
    expect(x.sock.started).toBe(true);
  });
});

describe("LiveSessionController: audio", () => {
  it("sends frames and shows the level", async () => {
    const x = setup();
    await x.c.share();
    x.frame(loud(0.5));
    expect(x.sock.frames).toHaveLength(1);
    expect(x.s().level).toBeGreaterThan(0.4);
  });

  it("warns after 10 s of silence and clears when sound returns", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onState("ready");
    x.at(0);
    x.frame(quiet());
    x.at(10_000);
    x.frame(quiet());
    expect(x.s().notice).toMatch(/No sound from the Meet tab/);
    x.at(10_100);
    x.frame(loud());
    expect(x.s().notice).toBeNull();
  });

  it("warns when the tab is in the background", async () => {
    const x = setup();
    await x.c.share();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    x.frame(loud());
    expect(x.s().notice).toMatch(/background/);
    vi.restoreAllMocks();
  });

  it("stops cleanly when sharing ends", async () => {
    const x = setup();
    await x.c.share();
    x.shareEnded();
    expect(x.s().status).toBe("stopped");
    expect(x.sock.stopped).toBe(true);
    expect(x.s().problem).toBe("Sharing stopped.");
  });
});

describe("LiveSessionController: questions and outlines", () => {
  it("asks for an outline when the partner finishes speaking, joining the turn", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onPartial("Tell me");
    expect(x.s().partial).toBe("Tell me");
    x.sock.ev.onFinal(final("u1", "So,"));
    x.sock.ev.onFinal(final("u2", "why do you want this job?"));
    expect(x.s().partial).toBe("");
    expect(x.s().lines.map((l) => l.text)).toEqual([
      "So,",
      "why do you want this job?",
    ]);
    expect(x.streams).toHaveLength(2); // one request per finished utterance...
    expect(x.streams[1].req.question).toBe("So, why do you want this job?"); // ...the latest has the whole turn
    expect(x.streams[1].req.utteranceIds).toEqual(["u1", "u2"]);
  });

  it("shows the user's own speech as You but never answers it", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onFinal(final("u1", "My answer is...", "you"));
    expect(x.streams).toHaveLength(0);
    expect(x.s().lines).toMatchObject([
      { speaker: "you", text: "My answer is..." },
    ]);
  });

  it('measures "first words" from the END of the question to the first token', async () => {
    const x = setup();
    await x.c.share();
    // The partner talks until t=1100, then goes quiet. The detector needs 350 ms of silence to be
    // sure the turn is over, but stamps the end at the LAST loud frame (1100), not the timeout.
    x.at(1000);
    x.frame(loud());
    x.at(1100);
    x.frame(loud());
    x.at(1300);
    x.frame(quiet());
    x.at(1500);
    x.frame(quiet());
    x.at(1900); // the transcription provider's final arrives later
    x.sock.ev.onFinal(final("u1", "Why us?"));
    x.at(2000); // first streamed token
    x.streams[0].h.onDelta("TYPE: company");
    expect(x.s().outline!.firstWordsMs).toBe(900); // 2000 - 1100
    x.at(2500);
    x.streams[0].h.onDelta(" more");
    expect(x.s().outline!.firstWordsMs).toBe(900); // measured once, on the first token
    expect(x.s().outline!.text).toBe("TYPE: company more");
  });

  it("falls back to the request time when no end of speech was seen (typed or missed)", async () => {
    const x = setup();
    await x.c.share();
    x.at(5000);
    x.sock.ev.onFinal(final("u1", "Why us?"));
    x.at(5700);
    x.streams[0].h.onDelta("hi");
    expect(x.s().outline!.firstWordsMs).toBe(700);
  });

  it("a newer question cancels the unfinished outline and only the newest is shown", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onFinal(final("u1", "First question about teamwork?"));
    x.streams[0].h.onDelta("old text");
    x.sock.ev.onFinal(final("u2", "Second question about leadership?"));
    expect(x.streams[0].req.signal.aborted).toBe(true);
    expect(x.streams[1].req.signal.aborted).toBe(false);
    x.streams[0].h.onDelta(" STALE"); // a late event from the cancelled stream
    x.streams[0].h.onDone({
      suggestion_id: "old",
      first_token_ms: 1,
      total_ms: 1,
      grounding_flags: [],
    });
    expect(x.s().outline!.text).toBe("");
    x.streams[1].h.onDelta("new text");
    expect(x.s().outline!.text).toBe("new text");
    expect(x.s().outline!.question).toContain("Second question");
  });

  it("completes with the suggestion id and grounding flags", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onFinal(final("u1", "Why us?"));
    x.streams[0].h.onDelta("TYPE: company");
    x.streams[0].h.onDone({
      suggestion_id: "s9",
      first_token_ms: 900,
      total_ms: 2100,
      grounding_flags: ["Cut by 45%"],
    });
    expect(x.s().outline).toMatchObject({
      state: "done",
      suggestionId: "s9",
      flags: ["Cut by 45%"],
    });
  });

  it("small talk (skip) shows nothing new and keeps the previous outline", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onFinal(final("u1", "Why us?"));
    x.streams[0].h.onDelta("real outline");
    x.streams[0].h.onDone({
      suggestion_id: "a",
      first_token_ms: 1,
      total_ms: 1,
      grounding_flags: [],
    });
    x.sock.ev.onFinal(final("u2", "Nice weather today"));
    expect(x.s().outline!.state).toBe("streaming"); // briefly, while the server decides
    x.streams[1].h.onSkip();
    expect(x.s().outline!.text).toBe("real outline");
  });

  it("small talk first leaves the panel empty", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onFinal(final("u1", "Hello there"));
    x.streams[0].h.onSkip();
    expect(x.s().outline).toBeNull();
  });

  it("a failed outline shows its message and does not block the next question", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onFinal(final("u1", "Why us?"));
    x.streams[0].h.onError({
      code: "answer_unavailable",
      message: "The answer couldn't be written.",
      next_step: "Ask again.",
    });
    expect(x.s().outline).toMatchObject({ state: "error" });
    expect(x.s().status).not.toBe("error"); // captions and capture carry on
    x.sock.ev.onFinal(final("u2", "What is your biggest strength?"));
    x.streams[1].h.onDelta("fine");
    expect(x.s().outline!.text).toBe("fine");
  });

  it("regenerate asks the same question again with the flag set", async () => {
    const x = setup();
    await x.c.share();
    x.c.regenerate(); // nothing to regenerate yet
    expect(x.streams).toHaveLength(0);
    x.sock.ev.onFinal(final("u1", "Why us?"));
    x.streams[0].h.onDone({
      suggestion_id: "a",
      first_token_ms: 1,
      total_ms: 1,
      grounding_flags: [],
    });
    x.c.regenerate();
    expect(x.streams[1].req).toMatchObject({
      question: "Why us?",
      regenerate: true,
    });
  });

  it("a typed question is added to the transcript and answered", async () => {
    const x = setup();
    x.c.submitManual("  What is your biggest weakness?  ");
    expect(x.s().lines[0]).toMatchObject({
      speaker: "typed",
      text: "What is your biggest weakness?",
    });
    expect(x.streams[0].req).toMatchObject({
      question: "What is your biggest weakness?",
      utteranceIds: [],
    });
    x.c.submitManual("   ");
    expect(x.streams).toHaveLength(1);
  });
});

describe("LiveSessionController: failures", () => {
  it("daily cap: stops capture and keeps the rest of the app available", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onCap();
    expect(x.s().status).toBe("stopped");
    expect(x.s().problem).toMatch(/Daily limit reached/);
    expect(x.cap.stop).toHaveBeenCalled();
  });

  it("capture lost after reconnects fail", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onState("reconnecting"); // shows the "Reconnecting…" notice...
    expect(x.s().notice).toBe("Reconnecting…");
    x.sock.ev.onLost();
    expect(x.s().notice).toBeNull(); // ...which must not linger once capture is lost
    expect(x.s().status).toBe("error");
    expect(x.s().problem).toMatch(/Capture lost/);
    expect(x.s().problem).toMatch(/Share Meet tab/);
  });

  it("a server error is plain and points to typing the question", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onError({
      code: "not_configured",
      message: "The OpenAI key is not configured on the server.",
    });
    expect(x.s().status).toBe("error");
    expect(x.s().problem).toMatch(/OpenAI key is not configured/);
    expect(x.s().problem).toMatch(/type the question/);
  });

  it("an upstream-slow message is handled by the socket's own reconnect", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onError({
      code: "upstream_slow",
      message: "Transcription fell behind. Reconnecting.",
    });
    expect(x.s().status).not.toBe("error");
    expect(x.cap.stop).not.toHaveBeenCalled();
  });

  it("marks the gap in the transcript after a reconnect", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onResumed(3200);
    expect(x.s().lines.at(-1)).toMatchObject({
      speaker: "gap",
      text: "[connection lost for about 3 s]",
    });
  });

  it("shows Reconnecting while the socket retries", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onState("ready");
    x.sock.ev.onState("reconnecting");
    expect(x.s().status).toBe("reconnecting");
    x.sock.ev.onState("ready");
    expect(x.s().status).toBe("listening");
  });
});

describe("LiveSessionController: ending", () => {
  it("end() stops everything and tells the server, once", async () => {
    const x = setup();
    await x.c.share();
    x.sock.ev.onFinal(final("u1", "Why us?"));
    await x.c.end();
    await x.c.end();
    expect(x.cap.stop).toHaveBeenCalled();
    expect(x.sock.stopped).toBe(true);
    expect(x.streams[0].req.signal.aborted).toBe(true);
    expect(x.s().status).toBe("ended");
    expect(x.endSession).toHaveBeenCalledTimes(1);
    x.c.submitManual("anything?"); // no more questions after the end
    expect(x.streams).toHaveLength(1);
  });

  it("still ends in the browser if the server call fails", async () => {
    const x = setup();
    x.endSession.mockRejectedValue(new Error("offline"));
    await x.c.share();
    await x.c.end();
    expect(x.s().status).toBe("ended");
  });

  it("can share again after the page cleaned up and set up again (React StrictMode)", async () => {
    const x = setup();
    x.c.dispose(); // StrictMode: cleanup runs before the real setup
    await x.c.share();
    expect(x.sock.started).toBe(true);
    expect(x.s().status).toBe("starting");
  });

  it("leaving the page stops capture without ending the session", async () => {
    const x = setup();
    await x.c.share();
    x.c.dispose();
    expect(x.cap.stop).toHaveBeenCalled();
    expect(x.endSession).not.toHaveBeenCalled();
  });
});
