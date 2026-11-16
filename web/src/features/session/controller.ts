import {
  AudioSocket,
  type FinalCaption,
  type SocketOptions,
} from "../../audio/AudioSocket";
import {
  CaptureError,
  type TabCapture,
  startTabCapture,
} from "../../audio/captureTab";
import { SilenceWatch, SpeechEndDetector, rmsLevel } from "../../audio/pcm";
import {
  type DoneInfo,
  type OutlineRequest,
  streamOutline,
} from "../../audio/suggestStream";
import { assembleTurn, useLiveStore } from "./store";

type Store = typeof useLiveStore;

export interface ControllerDeps {
  sessionId: string;
  sampleRate: number;
  /** A fresh single-use audio token. */
  fetchToken: () => Promise<string>;
  endSession: () => Promise<unknown>;
  store?: Store;
  capture?: typeof startTabCapture;
  makeSocket?: (
    o: SocketOptions,
    ev: ConstructorParameters<typeof AudioSocket>[1],
  ) => AudioSocket;
  stream?: typeof streamOutline;
  now?: () => number;
}

/** Runs one live session: share the tab, relay audio, show captions, and stream an outline for
 *  each question. Each concern updates the store independently, so an error in one (a failed
 *  outline) never stops the others (captions keep flowing). */
export class LiveSessionController {
  private readonly s: Store;
  private readonly now: () => number;
  private capture: TabCapture | null = null;
  private socket: AudioSocket | null = null;
  private abort: AbortController | null = null;
  private readonly detector = new SpeechEndDetector();
  private readonly silence = new SilenceWatch();
  private noteSeq = 0;
  private ended = false;

  constructor(private readonly d: ControllerDeps) {
    this.s = d.store ?? useLiveStore;
    this.now = d.now ?? (() => performance.now());
  }

  private get state() {
    return this.s.getState();
  }

  /** Must run from a click: the browser's share picker needs a user gesture. */
  async share(): Promise<void> {
    if (this.ended || this.capture) return;
    this.state.set({ status: "starting", problem: null, notice: null });
    const makeSocket = this.d.makeSocket ?? ((o, ev) => new AudioSocket(o, ev));
    this.socket = makeSocket(
      { sessionId: this.d.sessionId, getToken: this.d.fetchToken },
      {
        onState: (st) => {
          if (this.ended) return;
          if (st === "ready")
            this.state.set({ status: "listening", problem: null });
          else if (st === "reconnecting")
            this.state.set({ status: "reconnecting", notice: "Reconnecting…" });
        },
        onReady: () => this.state.set({ notice: null }),
        onPartial: (text) => this.state.set({ partial: text }),
        onFinal: (f) => this.onFinal(f),
        onError: (e) => this.fail(e.message || "Transcription failed.", e.code),
        onCap: () => {
          this.stopAudio();
          this.state.set({
            status: "stopped",
            problem:
              "Daily limit reached. Your notes and past sessions are still available.",
          });
        },
        onResumed: (gapMs) => {
          this.noteSeq += 1;
          this.state.addLine({
            key: `gap-${this.noteSeq}`,
            speaker: "gap",
            text: `[connection lost for about ${Math.max(1, Math.round(gapMs / 1000))} s]`,
          });
        },
        onLost: () => {
          this.stopAudio();
          this.state.set({
            status: "error",
            problem:
              'Capture lost: the connection was down too long. Press "Share Meet tab" to start again.',
          });
        },
      },
    );
    try {
      this.capture = await (this.d.capture ?? startTabCapture)(
        this.d.sampleRate,
        {
          onFrame: (pcm) => this.onFrame(pcm),
          onEnded: () => this.onShareEnded(),
        },
      );
    } catch (e) {
      this.socket = null;
      const msg =
        e instanceof CaptureError ? e.message : "Couldn't start capture.";
      this.state.set({ status: "error", problem: msg });
      return;
    }
    this.socket.start();
  }

  private onFrame(pcm: Int16Array): void {
    const t = this.now();
    const level = rmsLevel(pcm);
    this.state.set({ level });
    this.detector.push(level, t);
    const silent = this.silence.push(level, t);
    const hidden =
      typeof document !== "undefined" && document.visibilityState === "hidden";
    const notice = silent
      ? "No sound from the Meet tab for 10 s. Check Meet is unmuted, you are wearing headphones, and the tab was shared with audio."
      : hidden
        ? "This tab is in the background and Chrome may slow it down. Bring it forward or keep it visible."
        : null;
    if (notice !== this.state.notice && this.state.status !== "reconnecting")
      this.state.set({ notice });
    this.socket?.sendAudio(pcm.buffer as ArrayBuffer);
  }

  private onShareEnded(): void {
    if (this.ended) return;
    this.socket?.stop();
    this.socket = null;
    this.capture = null;
    this.state.set({
      status: "stopped",
      level: 0,
      partial: "",
      notice: null,
      problem: "Sharing stopped.",
    });
  }

  private onFinal(f: FinalCaption): void {
    if (f.speaker !== "partner") return; // the microphone is transcribed for review but never answered
    this.state.addLine({
      key: f.id,
      id: f.id,
      seq: f.seq,
      speaker: "partner",
      text: f.text,
    });
    this.state.set({ partial: "" });
    const turn = assembleTurn(this.state.lines);
    void this.ask(turn.text, turn.ids, false, this.detector.takeEnd());
  }

  /** The user typed a question (to try the app alone, or when transcription is unavailable). */
  submitManual(text: string): void {
    const q = text.trim();
    if (!q || this.ended) return;
    this.noteSeq += 1;
    this.state.addLine({
      key: `typed-${this.noteSeq}`,
      speaker: "typed",
      text: q,
    });
    void this.ask(q, [], false, this.now());
  }

  regenerate(): void {
    const o = this.state.outline;
    if (!o || this.ended) return;
    void this.ask(o.question, [], true, this.now());
  }

  private async ask(
    question: string,
    utteranceIds: string[],
    regenerate: boolean,
    speechEndedAt: number | null,
  ): Promise<void> {
    if (!question.trim()) return;
    // The newest question wins: cancel any outline still streaming (the server cancels the model).
    this.abort?.abort();
    const ctl = new AbortController();
    this.abort = ctl;
    const previous = this.state.outline;
    const startedAt = speechEndedAt ?? this.now();
    this.state.setOutline({
      question,
      text: "",
      state: "streaming",
      flags: [],
      revealed: false,
    });
    const current = () => this.abort === ctl; // ignore events from a replaced stream
    const req: OutlineRequest = {
      sessionId: this.d.sessionId,
      question,
      utteranceIds,
      regenerate,
      signal: ctl.signal,
    };
    await (this.d.stream ?? streamOutline)(req, {
      onDelta: (text) => {
        if (!current()) return;
        const o = this.state.outline;
        if (!o) return;
        this.state.patchOutline({
          text: o.text + text,
          firstWordsMs:
            o.firstWordsMs ?? Math.max(0, Math.round(this.now() - startedAt)),
        });
      },
      onSkip: () => {
        if (current()) this.state.setOutline(previous); // not a question: nothing new to show
      },
      onDone: (info: DoneInfo) => {
        if (current())
          this.state.patchOutline({
            state: "done",
            suggestionId: info.suggestion_id,
            flags: info.grounding_flags,
          });
      },
      onError: (error) => {
        if (current()) this.state.patchOutline({ state: "error", error });
      },
    });
  }

  private fail(message: string, code: string): void {
    if (code === "upstream_slow") return; // the socket reconnects by itself
    this.stopAudio();
    this.state.set({
      status: "error",
      problem: `${message} You can type the question below to keep practising.`,
    });
  }

  private stopAudio(): void {
    this.capture?.stop();
    this.capture = null;
    this.socket?.stop();
    this.socket = null;
    this.abort?.abort();
    this.state.set({ level: 0, notice: null, partial: "" });
  }

  /** End the session: stop everything, then tell the server. */
  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.stopAudio();
    this.state.set({ status: "ended", notice: null });
    try {
      await this.d.endSession();
    } catch {
      /* the session still ends in the browser; the server closes it on its own cap */
    }
  }

  /** Leave the page without ending the session. This must NOT make the controller unusable: React
   *  StrictMode (development) runs an effect's cleanup and then its setup again on the same
   *  instance, and the user can return to the page. Only end() is final. */
  dispose(): void {
    this.stopAudio();
  }
}
