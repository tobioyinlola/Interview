import {
  AudioSocket,
  type FinalCaption,
  type SocketOptions,
} from "../../audio/AudioSocket";
import {
  CaptureError,
  type TabCapture,
  startMicCapture,
  startTabCapture,
} from "../../audio/captureTab";
import { ApiError } from "../../api/client";
import { SegmentRecorder } from "../../audio/segments";
import { postSegment } from "../../audio/segmentApi";
import { SilenceWatch, SpeechEndDetector, rmsLevel } from "../../audio/pcm";
import {
  type DoneInfo,
  type OutlineRequest,
  streamOutline,
} from "../../audio/suggestStream";
import { looksLikeQuestion } from "./looksLikeQuestion";
import { assembleTurn, useLiveStore } from "./store";

/** How long the interviewer must be quiet before a question that does not end in "?" is answered. */
const SETTLE_MS = 1200;

type Store = typeof useLiveStore;

export interface ControllerDeps {
  sessionId: string;
  sampleRate: number;
  /** A fresh single-use audio token. */
  fetchToken: () => Promise<string>;
  endSession: () => Promise<unknown>;
  store?: Store;
  capture?: typeof startTabCapture;
  micCapture?: typeof startMicCapture;
  postSegment?: typeof postSegment;
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
  private micCapture: TabCapture | null = null;
  private micSocket: AudioSocket | null = null;
  private recorder: SegmentRecorder | null = null;
  /** Consecutive streaming failures; two in a row switch to the fallback mode. */
  private streamFailures = 0;
  private abort: AbortController | null = null;
  /** A request made while an answer is up, to find out whether the interviewer asked something new.
   *  It is invisible until the server says it is a question; only then does it replace the answer. */
  private probe: AbortController | null = null;
  private readonly detector = new SpeechEndDetector();
  private readonly silence = new SilenceWatch();
  private noteSeq = 0;
  private ended = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

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
        onPartial: (text) => {
          this.state.set({ partial: text });
          if (text) this.clearSettle(); // still talking: the question is not finished
        },
        onFinal: (f) => this.onFinal(f),
        onError: (e) => this.fail(e.message || "Transcription failed.", e.code),
        onCap: () => {
          this.stopAudio();
          this.state.set({
            status: "stopped",
            problem:
              "Daily limit reached. Your CV and past sessions are still available.",
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
    if (this.state.mode === "segments") {
      const segment = this.recorder?.push(pcm, level, t) ?? null;
      if (segment) void this.sendSegment(segment);
      return;
    }
    this.socket?.sendAudio(pcm.buffer as ArrayBuffer);
  }

  // ---- fallback: per-utterance transcription (FR-20) ----------------------------------------

  /** Live streaming failed twice in a row: stop streaming, cut speech into segments, send each
   *  for file transcription, and tell the user it is slower. */
  private enterSegmentMode(): void {
    if (this.state.mode === "segments" || this.ended) return;
    this.socket?.stop();
    this.socket = null;
    this.recorder = new SegmentRecorder(this.d.sampleRate);
    this.state.set({
      mode: "segments",
      status: "listening",
      problem: null,
      notice:
        "Live transcription paused. Using slower sentence-by-sentence transcription: captions appear after each pause.",
    });
  }

  private async sendSegment(pcm: Int16Array): Promise<void> {
    try {
      const res = await (this.d.postSegment ?? postSegment)(
        this.d.sessionId,
        pcm,
        this.d.sampleRate,
        "partner",
      );
      if (this.ended || !res.text) return;
      this.state.addLine({
        key: res.id ?? `seg-${(this.noteSeq += 1)}`,
        id: res.id ?? undefined,
        seq: res.seq ?? undefined,
        speaker: "partner",
        text: res.text,
      });
      this.askAboutTurn();
    } catch (e) {
      if (this.ended) return;
      if (e instanceof ApiError && e.code === "daily_cap") {
        this.stopAudio();
        this.state.set({
          status: "stopped",
          problem:
            "Daily limit reached. Your CV and past sessions are still available.",
        });
      } else if (e instanceof ApiError && e.code === "not_configured") {
        this.stopAudio();
        this.state.set({
          status: "error",
          problem: `${e.message} You can type the question below.`,
        });
      } else {
        this.state.set({
          notice:
            "Couldn't transcribe the last sentence. Keep talking, or type the question.",
        });
      }
    }
  }

  // ---- the user's microphone (FR-17) ---------------------------------------------------------

  /** Optionally transcribe the user's own voice, with echo cancellation. Labelled "You", never
   *  answered, and a line from the user ends the partner's current turn. */
  async setMic(on: boolean): Promise<void> {
    if (this.ended) return;
    if (!on) {
      this.stopMic();
      this.state.set({ mic: "off", micProblem: null, micLevel: 0 });
      return;
    }
    if (this.micCapture) return;
    this.state.set({ mic: "starting", micProblem: null });
    const makeSocket = this.d.makeSocket ?? ((o, ev) => new AudioSocket(o, ev));
    const fail = (msg: string) => {
      this.stopMic();
      this.state.set({ mic: "error", micProblem: msg, micLevel: 0 });
    };
    this.micSocket = makeSocket(
      {
        sessionId: this.d.sessionId,
        speaker: "you",
        getToken: this.d.fetchToken,
      },
      {
        onState: () => undefined,
        onReady: () => this.state.set({ mic: "on" }),
        onPartial: () => undefined,
        onFinal: (f) => this.onFinal(f),
        onError: (e) => fail(e.message || "Microphone transcription failed."),
        onCap: () => fail("Daily limit reached."),
        onResumed: () => undefined,
        onLost: () => fail("The microphone connection was lost."),
      },
    );
    try {
      this.micCapture = await (this.d.micCapture ?? startMicCapture)(
        this.d.sampleRate,
        {
          onFrame: (pcm) => this.onMicFrame(pcm),
          onEnded: () => fail("The microphone stopped."),
        },
      );
    } catch (e) {
      this.micSocket = null;
      this.state.set({
        mic: "error",
        micProblem:
          e instanceof CaptureError
            ? e.message
            : "Couldn't start the microphone.",
      });
      return;
    }
    this.micSocket.start();
  }

  private onMicFrame(pcm: Int16Array): void {
    this.state.set({ micLevel: rmsLevel(pcm) });
    this.micSocket?.sendAudio(pcm.buffer as ArrayBuffer);
  }

  private stopMic(): void {
    this.micCapture?.stop();
    this.micCapture = null;
    this.micSocket?.stop();
    this.micSocket = null;
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
    if (f.speaker === "you") {
      // The microphone is transcribed for the review but never answered. A line from the user
      // ends the partner's turn (assembleTurn stops at it), so a new question starts fresh.
      this.state.addLine({
        key: f.id,
        id: f.id,
        seq: f.seq,
        speaker: "you",
        text: f.text,
      });
      return;
    }
    this.streamFailures = 0;
    this.state.addLine({
      key: f.id,
      id: f.id,
      seq: f.seq,
      speaker: "partner",
      text: f.text,
    });
    this.state.set({ partial: "" });
    // While an answer is up it stays exactly as it is. Whatever else the interviewer says is only
    // looked at if it sounds like a new question, and then only a real question (the server decides)
    // replaces the answer. An answer that failed is not worth keeping, so anything may replace it.
    if (this.isLocked()) {
      const said = assembleTurn(
        this.state.lines.slice(this.state.lockedAt ?? 0),
      ).text;
      if (!looksLikeQuestion(said)) return;
    }
    this.scheduleAsk(f.text);
  }

  /** A question is answered once the interviewer has finished: at once when it ends in a question
   *  mark, otherwise after a short pause with no more speech, so a question asked in pieces is
   *  answered once, as a whole, and not locked in half-heard. */
  private scheduleAsk(lastText: string): void {
    this.clearSettle();
    if (/\?\s*$/.test(lastText)) {
      this.askAboutTurn();
      return;
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.askAboutTurn();
    }, SETTLE_MS);
  }

  private clearSettle(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  /** An answer is up and worth keeping (a failed one is not). */
  private isLocked(): boolean {
    return (
      this.state.lockedAt !== null && this.state.outline?.state !== "error"
    );
  }

  private askAboutTurn(): void {
    if (this.ended) return;
    const locked = this.isLocked();
    const from = locked ? (this.state.lockedAt ?? 0) : this.state.turnStart;
    const turn = assembleTurn(this.state.lines.slice(from));
    void this.ask(turn.text, turn.ids, false, this.detector.takeEnd(), locked);
  }

  /** "Done, next question": release the answer. What the interviewer said meanwhile becomes the next
   *  question (the server skips it if it is not a question). */
  markDone(): void {
    if (this.ended || !this.state.outline) return;
    this.abort?.abort(); // an answer still streaming is cancelled, the server stops the model
    this.probe?.abort();
    this.probe = null;
    this.clearSettle();
    const from = this.state.lockedAt ?? this.state.lines.length;
    this.state.setOutline(null);
    this.state.set({ lockedAt: null, turnStart: from });
    if (assembleTurn(this.state.lines.slice(from)).text) this.askAboutTurn();
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
    probe = false,
  ): Promise<void> {
    if (!question.trim()) return;
    const ctl = new AbortController();
    if (probe) {
      // The answer on screen is not touched, not even cancelled, until this proves to be a question.
      this.probe?.abort();
      this.probe = ctl;
    } else {
      // The newest question wins: cancel any answer still streaming (the server cancels the model).
      this.abort?.abort();
      this.probe?.abort();
      this.probe = null;
      this.abort = ctl;
    }
    let adopted = !probe;
    const previous = this.state.outline;
    const previousLock = this.state.lockedAt;
    const askedAt = this.state.lines.length;
    const startedAt = speechEndedAt ?? this.now();
    const begin = () => {
      // From here the answer is locked: it stays until a real new question or the person's Done.
      this.state.set({
        lockedAt: regenerate && previousLock !== null ? previousLock : askedAt,
      });
      this.state.setOutline({
        question,
        text: "",
        state: "streaming",
        flags: [],
        revealed: false,
      });
    };
    if (!probe) begin();
    const current = () => (adopted ? this.abort === ctl : this.probe === ctl); // ignore replaced streams
    const adopt = () => {
      this.abort?.abort(); // the old answer is finished with: the interviewer moved on
      this.abort = ctl;
      this.probe = null;
      adopted = true;
      begin();
    };
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
        if (!adopted) adopt(); // the first words of an answer: it was a question
        const o = this.state.outline;
        if (!o) return;
        this.state.patchOutline({
          text: o.text + text,
          firstWordsMs:
            o.firstWordsMs ?? Math.max(0, Math.round(this.now() - startedAt)),
        });
      },
      onSkip: () => {
        if (!current()) return;
        if (!adopted) {
          // Not a question: nothing on screen changes, and it will not be part of the next one.
          this.probe = null;
          this.state.set({ lockedAt: askedAt });
          return;
        }
        this.state.setOutline(previous);
        this.state.set({
          lockedAt: previousLock,
          turnStart: previous ? this.state.turnStart : askedAt,
        });
      },
      onDone: (info: DoneInfo) => {
        if (current() && adopted)
          this.state.patchOutline({
            state: "done",
            suggestionId: info.suggestion_id,
            flags: info.grounding_flags,
          });
      },
      onError: (error) => {
        // A failed look at something that may not even be a question must never disturb the answer.
        if (current() && adopted)
          this.state.patchOutline({ state: "error", error });
        else if (current()) this.probe = null;
      },
    });
  }

  private fail(message: string, code: string): void {
    if (code === "upstream_slow") return; // the socket reconnects by itself
    if (code === "upstream_error" || code === "upstream_unavailable") {
      this.streamFailures += 1;
      if (this.streamFailures >= 2) {
        this.enterSegmentMode(); // failed twice in a row: switch to the fallback
      } else {
        this.state.set({
          notice: "Transcription was interrupted. Reconnecting…",
        });
      }
      return;
    }
    this.stopAudio();
    this.state.set({
      status: "error",
      problem: `${message} You can type the question below to keep practising.`,
    });
  }

  private stopAudio(): void {
    this.clearSettle();
    this.capture?.stop();
    this.capture = null;
    this.socket?.stop();
    this.socket = null;
    this.stopMic();
    this.recorder = null;
    this.abort?.abort();
    this.probe?.abort();
    this.state.set({
      level: 0,
      notice: null,
      partial: "",
      mic: "off",
      micLevel: 0,
      mode: "live",
    });
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
