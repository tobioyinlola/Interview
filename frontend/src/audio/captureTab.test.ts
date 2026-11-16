import { CaptureError, NO_AUDIO_HELP, startTabCapture } from "./captureTab";

function fakeTrack() {
  const listeners: Record<string, () => void> = {};
  return {
    stop: vi.fn(),
    addEventListener: (ev: string, fn: () => void) => (listeners[ev] = fn),
    fire: (ev: string) => listeners[ev]?.(),
  };
}
function fakeStream(
  audio: ReturnType<typeof fakeTrack>[],
  video = [fakeTrack()],
) {
  return {
    getAudioTracks: () => audio,
    getTracks: () => [...audio, ...video],
  } as unknown as MediaStream;
}
const cb = () => ({ onFrame: vi.fn(), onEnded: vi.fn() });

describe("startTabCapture", () => {
  it("refuses to start without audio and explains the fix", async () => {
    const video = fakeTrack();
    const build = vi.fn();
    const err = await startTabCapture(24000, cb(), {
      getDisplayMedia: async () => fakeStream([], [video]),
      buildGraph: build,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CaptureError);
    expect(err.code).toBe("no_audio");
    expect(err.message).toBe(NO_AUDIO_HELP);
    expect(err.message).toMatch(/Also share tab audio/);
    expect(video.stop).toHaveBeenCalled(); // the share is released, not left running
    expect(build).not.toHaveBeenCalled();
  });

  it("asks for tab audio with processing off and without our own tab", async () => {
    const gdm = vi.fn(async () => fakeStream([fakeTrack()]));
    await startTabCapture(24000, cb(), {
      getDisplayMedia: gdm,
      buildGraph: async () => () => {},
    });
    expect(gdm).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        selfBrowserSurface: "exclude",
      }),
    );
  });

  it.each([
    ["NotAllowedError", "cancelled"],
    ["AbortError", "cancelled"],
    ["NotFoundError", "failed"],
  ])("maps %s to %s", async (name, code) => {
    const err = await startTabCapture(24000, cb(), {
      getDisplayMedia: async () => {
        throw new DOMException("x", name);
      },
    }).catch((e) => e);
    expect(err.code).toBe(code);
  });

  it("explains when the browser has no tab capture", async () => {
    vi.stubGlobal("navigator", { mediaDevices: undefined });
    const err = await startTabCapture(24000, cb()).catch((e) => e);
    vi.unstubAllGlobals();
    expect(err.code).toBe("unsupported");
    expect(err.message).toMatch(/Chrome or Edge/);
  });

  it("stops when sharing ends, once, and tells the caller", async () => {
    const audio = fakeTrack();
    const teardown = vi.fn();
    const c = cb();
    await startTabCapture(24000, c, {
      getDisplayMedia: async () => fakeStream([audio]),
      buildGraph: async () => teardown,
    });
    audio.fire("ended");
    audio.fire("ended");
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(c.onEnded).toHaveBeenCalledTimes(1);
    expect(audio.stop).toHaveBeenCalled();
  });

  it("stop() releases everything and does not report an end", async () => {
    const audio = fakeTrack();
    const teardown = vi.fn();
    const c = cb();
    const cap = await startTabCapture(24000, c, {
      getDisplayMedia: async () => fakeStream([audio]),
      buildGraph: async () => teardown,
    });
    cap.stop();
    cap.stop();
    audio.fire("ended");
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(c.onEnded).not.toHaveBeenCalled();
  });

  it("releases the share if the audio graph cannot be built", async () => {
    const audio = fakeTrack();
    const err = await startTabCapture(24000, cb(), {
      getDisplayMedia: async () => fakeStream([audio]),
      buildGraph: async () => {
        throw new Error("no worklet");
      },
    }).catch((e) => e);
    expect(err.code).toBe("failed");
    expect(audio.stop).toHaveBeenCalled();
  });

  it("passes frames through from the graph", async () => {
    const c = cb();
    let push!: (p: Int16Array) => void;
    await startTabCapture(24000, c, {
      getDisplayMedia: async () => fakeStream([fakeTrack()]),
      buildGraph: async (_s, rate, onFrame) => {
        expect(rate).toBe(24000);
        push = onFrame;
        return () => {};
      },
    });
    push(new Int16Array(1024));
    expect(c.onFrame).toHaveBeenCalledTimes(1);
  });
});
