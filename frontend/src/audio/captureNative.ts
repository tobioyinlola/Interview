import { isMobileApp } from "../app/native";
import { CaptureError, type TabCapture } from "./captureTab";

export type MobileAudioMode = "dual" | "device" | "mic";

export interface NativeCaptureCallbacks {
  /** One 16-bit PCM frame (1,024 samples) from the interviewer (device audio or mic in mic-only mode). */
  onInterviewerFrame: (pcm: Int16Array) => void;
  /** One 16-bit PCM frame from the candidate (mic in dual mode). */
  onCandidateFrame?: (pcm: Int16Array) => void;
  /** Warning event (e.g. device audio is silent). */
  onWarning?: (message: string) => void;
  /** Capture ended. */
  onEnded: () => void;
}

interface DualAudioPluginInterface {
  checkSupport: () => Promise<{ supported: boolean; minSdk?: number; currentSdk?: number }>;
  requestCapture: () => Promise<{ granted: boolean; reason?: string }>;
  startCapture: (options: { mode: MobileAudioMode; sampleRate: number }) => Promise<{ started: boolean }>;
  stopCapture: () => Promise<{ stopped: boolean }>;
  addListener: (
    eventName: string,
    listenerFunc: (data: any) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
  removeAllListeners?: () => Promise<void>;
}

function getDualAudioPlugin(): DualAudioPluginInterface | undefined {
  return window.Capacitor?.Plugins?.DualAudioCapture as DualAudioPluginInterface | undefined;
}

/** Check whether native dual-stream audio capture is supported on this device. */
export async function checkDualCaptureSupport(): Promise<boolean> {
  if (!isMobileApp()) return false;
  try {
    const plugin = getDualAudioPlugin();
    if (!plugin) return false;
    const res = await plugin.checkSupport();
    return res.supported ?? false;
  } catch {
    return false;
  }
}

/** Base64 string to Int16Array */
function base64ToInt16Array(base64: string): Int16Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

/**
 * Start native audio capture (Android MediaProjection + AudioPlaybackCapture or iOS ReplayKit Broadcast).
 */
export async function startNativeCapture(
  mode: MobileAudioMode,
  sampleRate: number,
  callbacks: NativeCaptureCallbacks,
): Promise<TabCapture> {
  const plugin = getDualAudioPlugin();
  if (!plugin) {
    throw new CaptureError("unsupported", "Native audio capture plugin not available.");
  }

  // If capturing device audio, ensure permission is granted
  if (mode === "dual" || mode === "device") {
    try {
      const perm = await plugin.requestCapture();
      if (!perm.granted) {
        throw new CaptureError(
          "cancelled",
          perm.reason || "Permission to capture device audio was denied or cancelled.",
        );
      }
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      throw new CaptureError("failed", "Could not request audio capture permission.");
    }
  }

  let frameSub: { remove: () => Promise<void> } | null = null;
  let warnSub: { remove: () => Promise<void> } | null = null;

  try {
    frameSub = await plugin.addListener("audioFrame", (event: { speaker: string; data: string }) => {
      try {
        const pcm = base64ToInt16Array(event.data);
        if (event.speaker === "you") {
          callbacks.onCandidateFrame?.(pcm);
        } else {
          callbacks.onInterviewerFrame(pcm);
        }
      } catch {
        // drop malformed frame
      }
    });

    warnSub = await plugin.addListener("audioWarning", (event: { code: string; message: string }) => {
      callbacks.onWarning?.(event.message);
    });

    await plugin.startCapture({ mode, sampleRate });
  } catch (e) {
    frameSub?.remove();
    warnSub?.remove();
    throw new CaptureError("failed", "Failed to start native audio capture.");
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    frameSub?.remove();
    warnSub?.remove();
    plugin.stopCapture().catch(() => {});
    callbacks.onEnded();
  };

  return { stop };
}
