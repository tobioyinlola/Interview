import { SilenceWatch, SpeechEndDetector, rmsLevel } from "./pcm";

const frame = (amp: number, n = 1024) =>
  new Int16Array(n).fill(Math.round(amp * 32767));

describe("rmsLevel", () => {
  it("is 0 for silence and an empty frame, and near 1 at full scale", () => {
    expect(rmsLevel(frame(0))).toBe(0);
    expect(rmsLevel(new Int16Array(0))).toBe(0);
    expect(rmsLevel(frame(1))).toBeGreaterThan(0.99);
  });
  it("scales with amplitude and ignores sign", () => {
    expect(rmsLevel(frame(0.5))).toBeCloseTo(0.5, 2);
    expect(rmsLevel(frame(-0.5))).toBeCloseTo(0.5, 2);
  });
});

describe("SpeechEndDetector", () => {
  it("reports the end of speech once, timestamped at the last loud moment", () => {
    const d = new SpeechEndDetector({ threshold: 0.1, hangoverMs: 300 });
    expect(d.push(0.5, 1000)).toBe(false);
    expect(d.push(0.4, 1100)).toBe(false);
    expect(d.push(0.01, 1200)).toBe(false); // short pause: still the same turn
    expect(d.push(0.01, 1350)).toBe(false);
    expect(d.push(0.01, 1400)).toBe(true); // 300 ms after the last loud frame
    expect(d.push(0.01, 1500)).toBe(false); // reported once
    expect(d.takeEnd()).toBe(1100);
    expect(d.takeEnd()).toBeNull();
  });
  it("a pause shorter than the hangover does not split the turn", () => {
    const d = new SpeechEndDetector({ threshold: 0.1, hangoverMs: 300 });
    d.push(0.5, 0);
    d.push(0.01, 200);
    expect(d.push(0.5, 250)).toBe(false);
    expect(d.takeEnd()).toBeNull();
  });
  it("never ends a turn that never started", () => {
    const d = new SpeechEndDetector();
    for (let t = 0; t < 5000; t += 100) expect(d.push(0, t)).toBe(false);
  });
});

describe("SilenceWatch", () => {
  it("flags only after the limit, and clears on sound", () => {
    const w = new SilenceWatch(10_000);
    expect(w.push(0, 0)).toBe(false);
    expect(w.push(0, 9_999)).toBe(false);
    expect(w.push(0, 10_000)).toBe(true);
    expect(w.push(0.2, 10_100)).toBe(false);
    expect(w.push(0, 10_200)).toBe(false); // the clock restarted
  });
});
