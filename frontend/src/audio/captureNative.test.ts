import { describe, expect, it, vi, beforeEach } from "vitest";
import { checkDualCaptureSupport, startNativeCapture } from "./captureNative";
import { CaptureError } from "./captureTab";

describe("captureNative", () => {
  beforeEach(() => {
    delete (window as any).Capacitor;
  });

  it("checkDualCaptureSupport returns false when not running in native app", async () => {
    const supported = await checkDualCaptureSupport();
    expect(supported).toBe(false);
  });

  it("checkDualCaptureSupport returns true when native plugin reports supported", async () => {
    (window as any).Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        DualAudioCapture: {
          checkSupport: vi.fn().mockResolvedValue({ supported: true, minSdk: 29 }),
        },
      },
    };
    const supported = await checkDualCaptureSupport();
    expect(supported).toBe(true);
  });

  it("throws unsupported if native plugin is missing", async () => {
    (window as any).Capacitor = {
      isNativePlatform: () => true,
      Plugins: {},
    };
    await expect(
      startNativeCapture("dual", 24000, {
        onInterviewerFrame: vi.fn(),
        onEnded: vi.fn(),
      }),
    ).rejects.toThrow(CaptureError);
  });

  it("requests capture permission for dual and device modes", async () => {
    let capturedListener: any = null;
    const requestCapture = vi.fn().mockResolvedValue({ granted: true });
    const startCapture = vi.fn().mockResolvedValue({ started: true });
    const stopCapture = vi.fn().mockResolvedValue({ stopped: true });
    const addListener = vi.fn().mockImplementation((name, cb) => {
      if (name === "audioFrame") capturedListener = cb;
      return Promise.resolve({ remove: vi.fn() });
    });

    (window as any).Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        DualAudioCapture: {
          checkSupport: vi.fn().mockResolvedValue({ supported: true }),
          requestCapture,
          startCapture,
          stopCapture,
          addListener,
        },
      },
    };

    const onInterviewer = vi.fn();
    const onCandidate = vi.fn();
    const onEnded = vi.fn();

    const capture = await startNativeCapture("dual", 24000, {
      onInterviewerFrame: onInterviewer,
      onCandidateFrame: onCandidate,
      onEnded,
    });

    expect(requestCapture).toHaveBeenCalledTimes(1);
    expect(startCapture).toHaveBeenCalledWith({ mode: "dual", sampleRate: 24000 });

    // Send a frame from interviewer
    const sampleBytes = new Uint8Array([0, 0, 10, 0]); // 2 16-bit samples
    const base64 = btoa(String.fromCharCode(...sampleBytes));

    capturedListener?.({ speaker: "partner", data: base64 });
    expect(onInterviewer).toHaveBeenCalledTimes(1);
    expect(onCandidate).not.toHaveBeenCalled();

    // Send a frame from candidate
    capturedListener?.({ speaker: "you", data: base64 });
    expect(onCandidate).toHaveBeenCalledTimes(1);

    capture.stop();
    expect(stopCapture).toHaveBeenCalledTimes(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("throws cancelled when user denies permission", async () => {
    (window as any).Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        DualAudioCapture: {
          requestCapture: vi.fn().mockResolvedValue({ granted: false, reason: "User cancelled" }),
          startCapture: vi.fn(),
          stopCapture: vi.fn(),
          addListener: vi.fn(),
        },
      },
    };

    await expect(
      startNativeCapture("dual", 24000, {
        onInterviewerFrame: vi.fn(),
        onEnded: vi.fn(),
      }),
    ).rejects.toThrow("User cancelled");
  });
});
