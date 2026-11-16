import { SegmentRecorder } from "./segments";

const RATE = 24000;
const FRAME_MS = (1024 / RATE) * 1000; // about 42.7 ms
const frame = (v = 1000) => new Int16Array(1024).fill(v);

/** Feed `ms` of loud (or quiet) audio; returns segments that ended. */
function feed(
  r: SegmentRecorder,
  t: { now: number },
  ms: number,
  loud: boolean,
) {
  const out: Int16Array[] = [];
  for (let spent = 0; spent < ms; spent += FRAME_MS) {
    t.now += FRAME_MS;
    const seg = r.push(frame(loud ? 3000 : 0), loud ? 0.2 : 0, t.now);
    if (seg) out.push(seg);
  }
  return out;
}

describe("SegmentRecorder", () => {
  it("cuts one segment after speech followed by a pause, with pre-roll", () => {
    const r = new SegmentRecorder(RATE);
    const t = { now: 0 };
    expect(feed(r, t, 400, false)).toHaveLength(0); // silence before speech: nothing
    expect(feed(r, t, 2000, true)).toHaveLength(0); // still talking
    const out = feed(r, t, 900, false); // the pause ends it
    expect(out).toHaveLength(1);
    expect(out[0].length).toBeGreaterThan((2000 / FRAME_MS) * 1024); // all of the speech
    expect(out[0][0]).toBe(0); // starts with the quiet pre-roll, so the first word is not clipped
  });

  it("splits two sentences separated by a pause into two segments", () => {
    const r = new SegmentRecorder(RATE);
    const t = { now: 0 };
    const out = [
      ...feed(r, t, 1500, true),
      ...feed(r, t, 900, false),
      ...feed(r, t, 1500, true),
      ...feed(r, t, 900, false),
    ];
    expect(out).toHaveLength(2);
  });

  it("a short pause inside a sentence does not split it", () => {
    const r = new SegmentRecorder(RATE);
    const t = { now: 0 };
    const out = [
      ...feed(r, t, 1000, true),
      ...feed(r, t, 300, false),
      ...feed(r, t, 1000, true),
      ...feed(r, t, 900, false),
    ];
    expect(out).toHaveLength(1);
  });

  it("ignores clicks and coughs shorter than the minimum speech", () => {
    const r = new SegmentRecorder(RATE);
    const t = { now: 0 };
    expect([...feed(r, t, 200, true), ...feed(r, t, 1000, false)]).toHaveLength(
      0,
    );
    // and it recovers: real speech afterwards still produces a segment
    expect([...feed(r, t, 1500, true), ...feed(r, t, 900, false)]).toHaveLength(
      1,
    );
  });

  it("cuts a very long monologue at the maximum length", () => {
    const r = new SegmentRecorder(RATE, { maxMs: 5000 });
    const t = { now: 0 };
    const out = feed(r, t, 12_000, true);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it("flush returns the sentence in progress, or nothing when idle", () => {
    const r = new SegmentRecorder(RATE);
    const t = { now: 0 };
    expect(r.flush()).toBeNull();
    feed(r, t, 1500, true);
    expect(r.flush()?.length).toBeGreaterThan(0);
    expect(r.flush()).toBeNull();
  });

  it("silence alone never produces a segment", () => {
    const r = new SegmentRecorder(RATE);
    expect(feed(r, { now: 0 }, 20_000, false)).toHaveLength(0);
  });
});
