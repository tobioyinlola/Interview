import { CaptureError, MIC_BLOCKED_HELP, startMicCapture } from "./captureTab";

const track = () => {
  const l: Record<string, () => void> = {};
  return {
    stop: vi.fn(),
    addEventListener: (e: string, f: () => void) => (l[e] = f),
    fire: (e: string) => l[e]?.(),
  };
};
const stream = (t = track()) =>
  ({
    getAudioTracks: () => [t],
    getTracks: () => [t],
  }) as unknown as MediaStream;
const cb = () => ({ onFrame: vi.fn(), onEnded: vi.fn() });

describe("startMicCapture", () => {
  it("asks for echo cancellation so the partner's voice is not transcribed as the user's", async () => {
    const gum = vi.fn(async () => stream());
    await startMicCapture(24000, cb(), {
      getUserMedia: gum,
      buildGraph: async () => () => {},
    });
    expect(gum).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });

  it.each([
    ["NotAllowedError", "cancelled", MIC_BLOCKED_HELP],
    ["SecurityError", "cancelled", MIC_BLOCKED_HELP],
    ["NotFoundError", "failed", "No microphone was found."],
    ["AbortError", "failed", "The browser couldn't start the microphone."],
  ])("explains %s plainly", async (name, code, message) => {
    const err = await startMicCapture(24000, cb(), {
      getUserMedia: async () => {
        throw new DOMException("x", name);
      },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CaptureError);
    expect([err.code, err.message]).toEqual([code, message]);
  });

  it("stops the tracks if the graph fails, and when the mic is unplugged", async () => {
    const t1 = track();
    const err = await startMicCapture(24000, cb(), {
      getUserMedia: async () => stream(t1),
      buildGraph: async () => {
        throw new Error("no worklet");
      },
    }).catch((e) => e);
    expect(err.code).toBe("failed");
    expect(t1.stop).toHaveBeenCalled();

    const t2 = track();
    const c = cb();
    await startMicCapture(24000, c, {
      getUserMedia: async () => stream(t2),
      buildGraph: async () => () => {},
    });
    t2.fire("ended");
    expect(c.onEnded).toHaveBeenCalledTimes(1);
  });

  it("stop() is idempotent and silent", async () => {
    const t = track();
    const c = cb();
    const teardown = vi.fn();
    const cap = await startMicCapture(24000, c, {
      getUserMedia: async () => stream(t),
      buildGraph: async () => teardown,
    });
    cap.stop();
    cap.stop();
    t.fire("ended");
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(c.onEnded).not.toHaveBeenCalled();
  });
});
