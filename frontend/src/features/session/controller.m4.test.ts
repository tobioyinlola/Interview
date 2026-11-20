import { ApiError } from "../../api/client";
import type {
  AudioSocket,
  SocketEvents,
  SocketOptions,
} from "../../audio/AudioSocket";
import { CaptureError, MIC_BLOCKED_HELP } from "../../audio/captureTab";
import type {
  OutlineHandlers,
  OutlineRequest,
} from "../../audio/suggestStream";
import { LiveSessionController } from "./controller";
import { useLiveStore } from "./store";

const loud = () => new Int16Array(1024).fill(9000);
const quiet = () => new Int16Array(1024);
const final = (
  id: string,
  text: string,
  speaker: "partner" | "you" = "partner",
) => ({
  id,
  seq: 1,
  speaker,
  text,
  ended_at: "x",
});

class FakeSocket {
  started = false;
  stopped = false;
  frames: ArrayBuffer[] = [];
  constructor(
    public opts: SocketOptions,
    public ev: SocketEvents,
  ) {}
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

function setup(
  over: {
    micError?: Error;
    postSegment?: (...a: unknown[]) => Promise<unknown>;
  } = {},
) {
  useLiveStore.getState().reset();
  let t = 0;
  const sockets: FakeSocket[] = [];
  const tabStop = vi.fn();
  const micStop = vi.fn();
  let tabCb!: { onFrame: (p: Int16Array) => void; onEnded: () => void };
  let micCb!: { onFrame: (p: Int16Array) => void; onEnded: () => void };
  const streams: { req: OutlineRequest; h: OutlineHandlers }[] = [];
  const postSegment = vi.fn(
    over.postSegment ??
      (async () => ({ id: "seg-1", seq: 1, text: "Why us?" })),
  );
  const c = new LiveSessionController({
    sessionId: "sess",
    sampleRate: 24000,
    fetchToken: async () => "tok",
    endSession: async () => ({}),
    now: () => t,
    capture: async (_r, cb) => {
      tabCb = cb;
      return { stop: tabStop };
    },
    micCapture: async (_r, cb) => {
      if (over.micError) throw over.micError;
      micCb = cb;
      return { stop: micStop };
    },
    makeSocket: (o, ev) => {
      const s = new FakeSocket(o, ev);
      sockets.push(s);
      return s as unknown as AudioSocket;
    },
    stream: (req, h) =>
      new Promise<void>(() => {
        streams.push({ req, h });
      }),
    postSegment: postSegment as never,
  });
  const s = () => useLiveStore.getState();
  const partner = () => sockets.find((k) => k.opts.speaker !== "you")!;
  const mic = () => sockets.find((k) => k.opts.speaker === "you")!;
  /** Speak (loud) or stay quiet for `ms`, one 43 ms frame at a time, on the tab capture. */
  const tab = (ms: number, isLoud: boolean) => {
    for (let spent = 0; spent < ms; spent += 43) {
      t += 43;
      tabCb.onFrame(isLoud ? loud() : quiet());
    }
  };
  return {
    c,
    s,
    sockets,
    partner,
    mic,
    tab,
    streams,
    postSegment,
    tabStop,
    micStop,
    micFrame: (p: Int16Array) => micCb.onFrame(p),
    micEnded: () => micCb.onEnded(),
  };
}

describe("microphone (FR-17)", () => {
  it("opens a second socket as 'you' and sends mic audio to it, never to the partner's", async () => {
    const x = setup();
    await x.c.share();
    await x.c.setMic(true);
    expect(x.s().mic).toBe("starting");
    expect(x.mic().opts.speaker).toBe("you");
    expect(x.mic().started).toBe(true);
    x.mic().ev.onReady(24000);
    expect(x.s().mic).toBe("on");
    x.micFrame(loud());
    expect(x.mic().frames).toHaveLength(1);
    expect(x.partner().frames).toHaveLength(0);
    expect(x.s().micLevel).toBeGreaterThan(0.2);
  });

  it("each socket gets its own fresh token (a token is single use)", async () => {
    const x = setup();
    await x.c.share();
    await x.c.setMic(true);
    expect(x.partner().opts.getToken).toBeTypeOf("function");
    expect(x.mic().opts.getToken).toBe(x.partner().opts.getToken); // the same function, called once per connection
  });

  it("labels the user's words You, never answers them, and a user line ends the partner's turn", async () => {
    const x = setup();
    await x.c.share();
    await x.c.setMic(true);
    x.partner().ev.onFinal(final("p1", "Tell me about a project?"));
    expect(x.streams).toHaveLength(1);
    x.mic().ev.onFinal(final("y1", "Sure, last year I led a launch.", "you"));
    expect(x.streams).toHaveLength(1); // not answered
    expect(x.s().lines.map((l) => l.speaker)).toEqual(["partner", "you"]);
    x.partner().ev.onFinal(final("p2", "And how did it go?"));
    expect(x.streams).toHaveLength(1); // the first answer stays until Done
    x.c.markDone();
    expect(x.streams[1].req.question).toBe("And how did it go?"); // the old question is not repeated
    expect(x.streams[1].req.utteranceIds).toEqual(["p2"]);
  });

  it("explains a blocked microphone and keeps the tab capture running", async () => {
    const x = setup({
      micError: new CaptureError("cancelled", MIC_BLOCKED_HELP),
    });
    await x.c.share();
    x.partner().ev.onState("ready");
    await x.c.setMic(true);
    expect(x.s().mic).toBe("error");
    expect(x.s().micProblem).toBe(MIC_BLOCKED_HELP);
    expect(x.s().status).toBe("listening");
    expect(x.sockets).toHaveLength(2);
    expect(x.mic().started).toBe(false); // the socket was never opened
  });

  it.each([
    [
      "error",
      (s: FakeSocket) =>
        s.ev.onError({
          code: "upstream_error",
          message: "Transcription was interrupted.",
        }),
    ],
    ["cap", (s: FakeSocket) => s.ev.onCap()],
    ["lost", (s: FakeSocket) => s.ev.onLost()],
  ])("a mic %s stops only the microphone", async (_n, trigger) => {
    const x = setup();
    await x.c.share();
    x.partner().ev.onState("ready");
    await x.c.setMic(true);
    trigger(x.mic());
    expect(x.s().mic).toBe("error");
    expect(x.s().micProblem).toBeTruthy();
    expect(x.micStop).toHaveBeenCalled();
    expect(x.s().status).toBe("listening");
    expect(x.tabStop).not.toHaveBeenCalled();
  });

  it("the microphone being unplugged is reported", async () => {
    const x = setup();
    await x.c.share();
    await x.c.setMic(true);
    x.micEnded();
    expect(x.s()).toMatchObject({
      mic: "error",
      micProblem: "The microphone stopped.",
    });
  });

  it("can be turned off and on again, and a second 'on' is ignored", async () => {
    const x = setup();
    await x.c.share();
    await x.c.setMic(true);
    await x.c.setMic(true);
    expect(x.sockets.filter((k) => k.opts.speaker === "you")).toHaveLength(1);
    await x.c.setMic(false);
    expect(x.s()).toMatchObject({ mic: "off", micLevel: 0 });
    expect(x.micStop).toHaveBeenCalledTimes(1);
    expect(x.mic().stopped).toBe(true);
    await x.c.setMic(true);
    expect(x.sockets.filter((k) => k.opts.speaker === "you")).toHaveLength(2);
  });

  it("ending the session stops the microphone, and it cannot be turned on afterwards", async () => {
    const x = setup();
    await x.c.share();
    await x.c.setMic(true);
    await x.c.end();
    expect(x.micStop).toHaveBeenCalled();
    await x.c.setMic(true);
    expect(x.s().mic).toBe("off");
  });
});

describe("fallback transcription (FR-20)", () => {
  const upstream = (x: ReturnType<typeof setup>, code = "upstream_error") =>
    x.partner().ev.onError({ code, message: "Transcription was interrupted." });

  it("the first failure only warns; the socket keeps reconnecting by itself", async () => {
    const x = setup();
    await x.c.share();
    upstream(x);
    expect(x.s().mode).toBe("live");
    expect(x.s().notice).toMatch(/Reconnecting/);
    expect(x.s().status).not.toBe("error");
    expect(x.partner().stopped).toBe(false);
  });

  it("two failures in a row switch to sentence-by-sentence mode and tell the user", async () => {
    const x = setup();
    await x.c.share();
    upstream(x);
    upstream(x, "upstream_unavailable");
    expect(x.s().mode).toBe("segments");
    expect(x.s().status).toBe("listening");
    expect(x.s().notice).toMatch(/slower sentence-by-sentence/);
    expect(x.partner().stopped).toBe(true);
  });

  it("a caption between two failures resets the count", async () => {
    const x = setup();
    await x.c.share();
    upstream(x);
    x.partner().ev.onFinal(
      final("p1", "Streaming works again, any questions?"),
    );
    upstream(x);
    expect(x.s().mode).toBe("live");
  });

  it("upstream_slow is ignored, and a missing key is a plain error, not a fallback", async () => {
    const x = setup();
    await x.c.share();
    x.partner().ev.onError({ code: "upstream_slow", message: "x" });
    expect(x.s().mode).toBe("live");
    x.partner().ev.onError({
      code: "not_configured",
      message: "The OpenAI key is not configured.",
    });
    expect(x.s().status).toBe("error");
    expect(x.s().mode).toBe("live");
  });

  it("in fallback mode audio goes to segments, not the socket, and each sentence is transcribed and answered", async () => {
    const x = setup();
    await x.c.share();
    upstream(x);
    upstream(x);
    const sent = x.partner().frames.length;
    x.tab(1500, true); // the partner speaks a sentence
    x.tab(900, false); // then pauses
    expect(x.partner().frames.length).toBe(sent); // nothing more is streamed
    await vi.waitFor(() => expect(x.postSegment).toHaveBeenCalledTimes(1));
    const [sessionId, pcm, rate, speaker] = x.postSegment.mock.calls[0] as [
      string,
      Int16Array,
      number,
      string,
    ];
    expect([sessionId, rate, speaker]).toEqual(["sess", 24000, "partner"]);
    expect(pcm.length).toBeGreaterThan(24000); // about a second and a half of audio
    await vi.waitFor(() => expect(x.s().lines).toHaveLength(1));
    expect(x.s().lines[0]).toMatchObject({
      speaker: "partner",
      text: "Why us?",
      id: "seg-1",
    });
    expect(x.streams[0].req).toMatchObject({
      question: "Why us?",
      utteranceIds: ["seg-1"],
    });
  });

  it("an empty transcription adds nothing", async () => {
    const x = setup({
      postSegment: async () => ({ id: null, seq: null, text: "" }),
    });
    await x.c.share();
    upstream(x);
    upstream(x);
    x.tab(1500, true);
    x.tab(900, false);
    await vi.waitFor(() => expect(x.postSegment).toHaveBeenCalled());
    await Promise.resolve();
    expect(x.s().lines).toHaveLength(0);
    expect(x.streams).toHaveLength(0);
  });

  it("a failed segment shows a gentle notice and carries on", async () => {
    const x = setup({
      postSegment: async () => {
        throw new ApiError(502, "transcription_failed", "x", "r");
      },
    });
    await x.c.share();
    upstream(x);
    upstream(x);
    x.tab(1500, true);
    x.tab(900, false);
    await vi.waitFor(() =>
      expect(x.s().notice).toMatch(/Couldn't transcribe the last sentence/),
    );
    expect(x.s().status).toBe("listening");
  });

  it("the daily limit and a missing key stop fallback capture with a clear message", async () => {
    for (const [code, expected, status] of [
      ["daily_cap", /Daily limit reached/, "stopped"],
      ["not_configured", /not configured/, "error"],
    ] as const) {
      const x = setup({
        postSegment: async () => {
          throw new ApiError(
            429,
            code,
            "The OpenAI key is not configured.",
            "r",
          );
        },
      });
      await x.c.share();
      upstream(x);
      upstream(x);
      x.tab(1500, true);
      x.tab(900, false);
      await vi.waitFor(() => expect(x.s().status).toBe(status));
      expect(x.s().problem).toMatch(expected);
      expect(x.tabStop).toHaveBeenCalled();
    }
  });

  it("ending the session returns to live mode state and sends nothing further", async () => {
    const x = setup();
    await x.c.share();
    upstream(x);
    upstream(x);
    await x.c.end();
    expect(x.s().mode).toBe("live");
    x.tab(1500, true);
    x.tab(900, false);
    expect(x.postSegment).not.toHaveBeenCalled();
  });
});
