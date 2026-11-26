import type { AudioSocket, SocketEvents } from "../../audio/AudioSocket";
import type { OutlineRequest } from "../../audio/suggestStream";
import { LiveSessionController } from "./controller";
import { useLiveStore } from "./store";
import { DEFAULT_TIMING, settleDelay, timing } from "./timing";

/** The answer is for the whole turn: it waits for the interviewer to finish. These use the real
 *  timings (the rest of the suite runs at the old quick ones). */

const loud = () => new Int16Array(1024).fill(9000);
const quiet = () => new Int16Array(1024);
const final = (id: string, text: string) => ({
  id,
  seq: Number(id.replace(/\D/g, "")) || 1,
  speaker: "partner" as const,
  text,
  ended_at: "2026-11-26T10:00:00Z",
});

function setup() {
  useLiveStore.getState().reset();
  let t = 0;
  let ev!: SocketEvents;
  let frame!: (p: Int16Array) => void;
  const asked: OutlineRequest[] = [];
  const c = new LiveSessionController({
    sessionId: "s",
    sampleRate: 24000,
    fetchToken: async () => "tok",
    endSession: async () => ({}),
    now: () => t,
    capture: async (_r, cb) => {
      frame = cb.onFrame;
      return { stop: () => undefined };
    },
    makeSocket: (_o, e) => {
      ev = e;
      return {
        start: () => undefined,
        stop: () => undefined,
        sendAudio: () => true,
      } as unknown as AudioSocket;
    },
    stream: (req) => {
      asked.push(req);
      return new Promise<void>(() => undefined);
    },
  });
  return {
    c,
    asked,
    ev: () => ev,
    frame: (p: Int16Array) => frame(p),
    at: (ms: number) => (t = ms),
  };
}

beforeEach(() => {
  Object.assign(timing, DEFAULT_TIMING);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("how long to wait after the last words", () => {
  it("fits what was said", () => {
    expect(settleDelay("Why this role?", "Why this role?")).toBe(
      DEFAULT_TIMING.afterQuestionMs,
    );
    expect(
      settleDelay("Walk me through your CV.", "Walk me through your CV."),
    ).toBe(DEFAULT_TIMING.afterStatementMs);
    for (const unfinished of [
      "Tell me about a time you had to work with someone",
      "Tell me about yourself and",
      "What would you say, ",
      "Can you describe how you handled the",
    ])
      expect(settleDelay(unfinished, unfinished)).toBe(
        DEFAULT_TIMING.unfinishedMs,
      );
  });

  it("waits longest when more questions were announced, until they have all come", () => {
    const lead = "I have a few questions for you.";
    expect(settleDelay(lead, lead)).toBe(DEFAULT_TIMING.announcedMs);
    expect(settleDelay("First, why this role?", "First, why this role?")).toBe(
      DEFAULT_TIMING.announcedMs,
    );
    const two = "I have two questions. First, why us? Second, why now?";
    expect(settleDelay(two, "Second, why now?")).toBe(
      DEFAULT_TIMING.afterQuestionMs,
    );
  });
});

describe("a turn is answered once, after the interviewer has finished", () => {
  it("does not answer at the first question mark; a second part is answered together with it", async () => {
    const x = setup();
    await x.c.share();
    x.ev().onFinal(final("u1", "Tell me about yourself?"));
    vi.advanceTimersByTime(1400);
    expect(x.asked).toHaveLength(0); // not yet: more may be coming
    x.ev().onFinal(final("u2", "And what drew you to this role?"));
    vi.advanceTimersByTime(1499);
    expect(x.asked).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(x.asked).toHaveLength(1);
    expect(x.asked[0]!.question).toBe(
      "Tell me about yourself? And what drew you to this role?",
    );
    expect(x.asked[0]!.utteranceIds).toEqual(["u1", "u2"]);
  });

  it("a single complete question is answered after the short pause", async () => {
    const x = setup();
    await x.c.share();
    x.ev().onFinal(final("u1", "Why do you want to work here?"));
    vi.advanceTimersByTime(1500);
    expect(x.asked).toHaveLength(1);
  });

  it("waits for a sentence that stopped half way", async () => {
    const x = setup();
    await x.c.share();
    x.ev().onFinal(final("u1", "Tell me about a time you worked with someone"));
    vi.advanceTimersByTime(3400);
    expect(x.asked).toHaveLength(0);
    x.ev().onFinal(final("u2", "who disagreed with you?"));
    vi.advanceTimersByTime(1500);
    expect(x.asked).toHaveLength(1);
    expect(x.asked[0]!.question).toContain("who disagreed with you?");
  });

  it("waits for all the announced questions", async () => {
    const x = setup();
    await x.c.share();
    x.ev().onFinal(final("u1", "I have a couple of questions for you."));
    vi.advanceTimersByTime(5900);
    expect(x.asked).toHaveLength(0);
    x.ev().onFinal(final("u2", "First, why this role?"));
    vi.advanceTimersByTime(5000);
    x.ev().onFinal(final("u3", "Second, how do you handle pressure?"));
    vi.advanceTimersByTime(1500);
    expect(x.asked).toHaveLength(1);
    expect(x.asked[0]!.question).toBe(
      "I have a couple of questions for you. First, why this role? Second, how do you handle pressure?",
    );
  });

  it("holds back while the interviewer can still be heard, even before the words are transcribed", async () => {
    const x = setup();
    await x.c.share();
    x.at(1000);
    x.frame(loud()); // still speaking
    x.ev().onFinal(final("u1", "Why this role?"));
    x.at(2400);
    x.frame(loud()); // still speaking
    vi.advanceTimersByTime(1500); // the wait is up, but they were just heard
    expect(x.asked).toHaveLength(0);
    x.at(3600);
    x.frame(quiet());
    x.at(4000);
    x.frame(quiet()); // silence past the guard
    vi.advanceTimersByTime(2000);
    expect(x.asked).toHaveLength(1);
  });

  it("never holds an answer back for ever, even if the room stays noisy", async () => {
    const x = setup();
    await x.c.share();
    x.ev().onFinal(final("u1", "Why this role?"));
    // constant noise: every check finds sound
    for (let i = 0; i < 40; i++) {
      x.at(1000 + i * 200);
      x.frame(loud());
      vi.advanceTimersByTime(200);
    }
    vi.advanceTimersByTime(5000);
    expect(x.asked).toHaveLength(1);
  });
});
