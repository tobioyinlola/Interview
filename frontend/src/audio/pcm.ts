/** Level and speech-end detection on 16-bit PCM frames. Pure, so it is tested without a browser. */

/** Root-mean-square level of a frame, 0 (silence) to 1 (full scale). */
export function rmsLevel(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / frame.length);
}

export interface DetectorOptions {
  /** Level above which a frame counts as speech. */
  threshold?: number;
  /** Silence needed after speech before the turn counts as finished (ms). */
  hangoverMs?: number;
}

/** Timestamps the moment the partner stops talking, so "first words in X s" can be measured from
 *  the end of their question. A light level-based detector with a hangover, as the prototype's. */
export class SpeechEndDetector {
  private readonly threshold: number;
  private readonly hangoverMs: number;
  private speaking = false;
  private lastLoud = 0;
  private heard = false;
  /** performance-clock time the last speech turn ended, or null if none finished since read. */
  lastEndedAt: number | null = null;

  constructor(opts: DetectorOptions = {}) {
    this.threshold = opts.threshold ?? 0.015;
    this.hangoverMs = opts.hangoverMs ?? 350;
  }

  /** Feed one frame with the current time. Returns true when a speech turn has just ended. */
  push(level: number, now: number): boolean {
    if (level >= this.threshold) {
      this.speaking = true;
      this.heard = true;
      this.lastLoud = now;
      return false;
    }
    if (this.speaking && now - this.lastLoud >= this.hangoverMs) {
      this.speaking = false;
      this.lastEndedAt = this.lastLoud; // the end of speech is the last loud moment, not the timeout
      return true;
    }
    return false;
  }

  /** How long it has been since the last loud moment: 0 while talking, Infinity if nothing has been
   *  heard yet. Used to hold an answer back while the interviewer is audibly still speaking, even
   *  before the words have been transcribed. */
  quietForMs(now: number): number {
    if (this.speaking) return 0;
    return this.lastLoud === 0 && !this.heard
      ? Infinity
      : Math.max(0, now - this.lastLoud);
  }

  /** Time the partner stopped speaking for the latest turn, consumed once. */
  takeEnd(): number | null {
    const t = this.lastEndedAt;
    this.lastEndedAt = null;
    return t;
  }
}

/** Flags a source that has been silent for a while (muted Meet tab, no headphones, throttled tab). */
export class SilenceWatch {
  private silentSince: number | null = null;
  constructor(
    private readonly limitMs = 10_000,
    private readonly floor = 0.002,
  ) {}

  /** Returns true while the source has been silent for at least the limit. */
  push(level: number, now: number): boolean {
    if (level > this.floor) {
      this.silentSince = null;
      return false;
    }
    if (this.silentSince === null) this.silentSince = now;
    return now - this.silentSince >= this.limitMs;
  }
}
