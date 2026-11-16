import { rmsLevel } from "./pcm";

export type CaptureErrorCode =
  "unsupported" | "cancelled" | "no_audio" | "failed";

export class CaptureError extends Error {
  constructor(
    public code: CaptureErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface TabCapture {
  stop: () => void;
}

export interface CaptureCallbacks {
  /** One 16-bit PCM frame (1,024 samples) from the shared tab. */
  onFrame: (pcm: Int16Array) => void;
  /** The user stopped sharing, or the tab was closed. */
  onEnded: () => void;
}

export interface CaptureDeps {
  getDisplayMedia?: (c: unknown) => Promise<MediaStream>;
  /** Builds the audio graph; replaced in tests because jsdom has no Web Audio. */
  buildGraph?: (
    stream: MediaStream,
    sampleRate: number,
    onFrame: (pcm: Int16Array) => void,
  ) => Promise<() => void>;
}

export const NO_AUDIO_HELP =
  'No audio was shared. In the share window pick the Meet tab and tick "Also share tab audio", then try again.';

/** Ask the user to share the Meet tab with its audio. Capture code lives only in this module, so a
 *  Chrome extension could replace it later without touching the rest of the app. */
export async function startTabCapture(
  sampleRate: number,
  cb: CaptureCallbacks,
  deps: CaptureDeps = {},
): Promise<TabCapture> {
  const getDisplayMedia =
    deps.getDisplayMedia ??
    navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
  if (!getDisplayMedia) {
    throw new CaptureError(
      "unsupported",
      "This browser cannot share tab audio. Use Chrome or Edge on a computer.",
    );
  }

  let stream: MediaStream;
  try {
    // Chrome-specific hints that the DOM typings do not list yet.
    const options = {
      video: { frameRate: 1 }, // the picker needs video; we never read it
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      selfBrowserSurface: "exclude",
      systemAudio: "exclude",
    };
    stream = await getDisplayMedia(options as DisplayMediaStreamOptions);
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === "NotAllowedError" || name === "AbortError") {
      throw new CaptureError(
        "cancelled",
        "Sharing was cancelled. Press the button to try again.",
      );
    }
    throw new CaptureError("failed", "The browser couldn't start tab capture.");
  }

  const audio = stream.getAudioTracks();
  if (audio.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError("no_audio", NO_AUDIO_HELP); // refuse to start, explain the fix
  }

  const build = deps.buildGraph ?? buildWebAudioGraph;
  let teardown: () => void;
  try {
    teardown = await build(stream, sampleRate, cb.onFrame);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError(
      "failed",
      "The browser couldn't start audio capture.",
    );
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    teardown();
    stream.getTracks().forEach((t) => t.stop());
  };
  // Capture stops when sharing ends (the Chrome "Stop sharing" bar, or the tab closing).
  audio[0].addEventListener("ended", () => {
    if (!stopped) {
      stop();
      cb.onEnded();
    }
  });
  return { stop };
}

/** AudioContext at the provider's sample rate (the browser resamples), then an AudioWorklet that
 *  batches 1,024-sample frames. Not connected to the speakers: nothing is played back. */
export async function buildWebAudioGraph(
  stream: MediaStream,
  sampleRate: number,
  onFrame: (pcm: Int16Array) => void,
): Promise<() => void> {
  const ctx = new AudioContext({ sampleRate });
  await ctx.audioWorklet.addModule("/pcm-worklet.js");
  const source = ctx.createMediaStreamSource(
    new MediaStream(stream.getAudioTracks()),
  );
  const node = new AudioWorkletNode(ctx, "pcm-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
  });
  node.port.onmessage = (m: MessageEvent<ArrayBuffer>) =>
    onFrame(new Int16Array(m.data));
  source.connect(node);
  return () => {
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    void ctx.close();
  };
}

export { rmsLevel };

export const MIC_BLOCKED_HELP =
  "Microphone access was blocked. Allow the microphone for this site in the browser, then try again.";

/** The user's own microphone, with echo cancellation so the partner's voice from the speakers is
 *  not transcribed as the user's. Transcribed for the review, never answered. */
export async function startMicCapture(
  sampleRate: number,
  cb: { onFrame: (pcm: Int16Array) => void; onEnded: () => void },
  deps: {
    getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
    buildGraph?: CaptureDeps["buildGraph"];
  } = {},
): Promise<TabCapture> {
  const getUserMedia =
    deps.getUserMedia ??
    navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (!getUserMedia) {
    throw new CaptureError(
      "unsupported",
      "This browser cannot use the microphone.",
    );
  }
  let stream: MediaStream;
  try {
    stream = await getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new CaptureError("cancelled", MIC_BLOCKED_HELP);
    }
    if (name === "NotFoundError") {
      throw new CaptureError("failed", "No microphone was found.");
    }
    throw new CaptureError(
      "failed",
      "The browser couldn't start the microphone.",
    );
  }
  let teardown: () => void;
  try {
    teardown = await (deps.buildGraph ?? buildWebAudioGraph)(
      stream,
      sampleRate,
      cb.onFrame,
    );
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError(
      "failed",
      "The browser couldn't start audio capture.",
    );
  }
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    teardown();
    stream.getTracks().forEach((t) => t.stop());
  };
  stream.getAudioTracks()[0]?.addEventListener("ended", () => {
    if (!stopped) {
      stop();
      cb.onEnded();
    }
  });
  return { stop };
}
