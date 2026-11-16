/** Cuts a stream of PCM frames into speech segments for the fallback transcription mode: used when
 *  live streaming has failed twice in a row. Pure, so it is tested without a browser. */

export interface SegmentOptions {
  /** Level above which a frame counts as speech. */
  threshold?: number;
  /** Silence that ends a segment (ms). */
  silenceMs?: number;
  /** A segment is cut at this length even if the speaker has not paused (ms). */
  maxMs?: number;
  /** Speech shorter than this is a cough or click, not a sentence (ms). */
  minSpeechMs?: number;
  /** Audio kept from just before speech began, so the first word is not clipped (frames). */
  preRoll?: number;
}

export class SegmentRecorder {
  private readonly threshold: number;
  private readonly silenceMs: number;
  private readonly maxMs: number;
  private readonly minSpeechMs: number;
  private readonly preRoll: number;
  private frames: Int16Array[] = [];
  private recent: Int16Array[] = [];
  private speaking = false;
  private startedAt = 0;
  private lastLoud = 0;
  private speechMs = 0;

  constructor(
    private readonly sampleRate = 24000,
    opts: SegmentOptions = {},
  ) {
    this.threshold = opts.threshold ?? 0.015;
    this.silenceMs = opts.silenceMs ?? 700;
    this.maxMs = opts.maxMs ?? 25_000;
    this.minSpeechMs = opts.minSpeechMs ?? 600;
    this.preRoll = opts.preRoll ?? 3;
  }

  /** Feed one frame. Returns a finished segment (all frames joined) when one ends, else null. */
  push(frame: Int16Array, level: number, now: number): Int16Array | null {
    const loud = level >= this.threshold;
    if (!this.speaking) {
      this.recent.push(frame);
      if (this.recent.length > this.preRoll) this.recent.shift();
      if (!loud) return null;
      this.speaking = true;
      this.startedAt = now;
      this.lastLoud = now;
      this.speechMs = 0;
      this.frames = [...this.recent];
      this.recent = [];
      this.speechMs += this.frameMs(frame);
      return null;
    }
    this.frames.push(frame);
    if (loud) {
      this.lastLoud = now;
      this.speechMs += this.frameMs(frame);
    }
    const silentFor = now - this.lastLoud;
    const length = now - this.startedAt;
    if (silentFor >= this.silenceMs || length >= this.maxMs)
      return this.finish();
    return null;
  }

  /** Flush whatever is buffered (the user stopped sharing mid-sentence). */
  flush(): Int16Array | null {
    return this.speaking ? this.finish() : null;
  }

  private frameMs(frame: Int16Array): number {
    return (frame.length / this.sampleRate) * 1000;
  }

  private finish(): Int16Array | null {
    const frames = this.frames;
    const enough = this.speechMs >= this.minSpeechMs;
    this.frames = [];
    this.speaking = false;
    this.recent = [];
    if (!enough) return null;
    const out = new Int16Array(frames.reduce((n, f) => n + f.length, 0));
    let at = 0;
    for (const f of frames) {
      out.set(f, at);
      at += f.length;
    }
    return out;
  }
}
