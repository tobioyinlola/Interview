import { AudioSocket, type SocketEvents } from "./AudioSocket";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = "";
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closeCode: number | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(d: string | ArrayBuffer) {
    this.sent.push(d);
  }
  close(code = 1000) {
    this.closeCode = code;
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  server(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  jsonSent() {
    return this.sent
      .filter((s): s is string => typeof s === "string")
      .map((s) => JSON.parse(s));
  }
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(over: { maxOutageMs?: number } = {}) {
  FakeWebSocket.instances = [];
  let n = 0;
  const events: SocketEvents = {
    onState: vi.fn(),
    onReady: vi.fn(),
    onPartial: vi.fn(),
    onFinal: vi.fn(),
    onError: vi.fn(),
    onCap: vi.fn(),
    onResumed: vi.fn(),
    onLost: vi.fn(),
  };
  const getToken = vi.fn(async () => `token-${++n}`);
  const sock = new AudioSocket(
    {
      sessionId: "sess",
      getToken,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      baseUrl: "http://api.test",
      now: () => Date.now(),
      ...over,
    },
    events,
  );
  return { sock, events, getToken };
}
const states = (e: SocketEvents) =>
  (e.onState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AudioSocket", () => {
  it("connects with the token as the first message, never in the URL", async () => {
    const { sock } = setup();
    sock.start();
    await flush();
    const ws = last();
    expect(ws.url).toBe(
      "ws://api.test/api/sessions/sess/audio?speaker=partner",
    );
    expect(ws.url).not.toContain("token");
    ws.open();
    expect(ws.jsonSent()).toEqual([{ type: "auth", token: "token-1" }]);
  });

  it("is not ready until the server says so, and drops audio until then", async () => {
    const { sock, events } = setup();
    sock.start();
    await flush();
    last().open();
    expect(sock.sendAudio(new ArrayBuffer(8))).toBe(false);
    last().server({ type: "ready", sample_rate: 24000 });
    expect(events.onReady).toHaveBeenCalledWith(24000);
    expect(sock.sendAudio(new ArrayBuffer(8))).toBe(true);
    expect(last().sent.filter((s) => s instanceof ArrayBuffer)).toHaveLength(1);
    expect(states(events)).toEqual(["connecting", "ready"]);
  });

  it("delivers partials and finals, and answers pings with pongs", async () => {
    const { sock, events } = setup();
    sock.start();
    await flush();
    last().open();
    last().server({ type: "ready", sample_rate: 24000 });
    last().server({ type: "partial", text: "Tell me" });
    last().server({
      type: "final",
      id: "u1",
      seq: 1,
      speaker: "partner",
      text: "Tell me more?",
      ended_at: "x",
    });
    last().server({ type: "ping" });
    expect(events.onPartial).toHaveBeenCalledWith("Tell me");
    expect(events.onFinal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1", seq: 1 }),
    );
    expect(last().jsonSent()).toContainEqual({ type: "pong" });
  });

  it("reconnects with a FRESH token after a drop and reports the gap", async () => {
    const { sock, events, getToken } = setup();
    sock.start();
    await flush();
    last().open();
    last().server({ type: "ready", sample_rate: 24000 });

    last().drop(1006);
    expect(sock.sendAudio(new ArrayBuffer(8))).toBe(false); // nothing is queued while down
    await vi.advanceTimersByTimeAsync(1000); // first backoff: 1 s
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(getToken).toHaveBeenCalledTimes(2);
    last().open();
    expect(last().jsonSent()).toEqual([{ type: "auth", token: "token-2" }]);
    last().server({ type: "ready", sample_rate: 24000 });
    expect(events.onResumed).toHaveBeenCalledWith(expect.any(Number));
    expect(events.onLost).not.toHaveBeenCalled();
    expect(states(events)).toEqual([
      "connecting",
      "ready",
      "reconnecting",
      "ready",
    ]);
  });

  it("backs off 1 s, 2 s, 3 s, 3 s and then reports capture lost", async () => {
    const { sock, events } = setup();
    sock.start();
    await flush();
    last().open();
    last().server({ type: "ready", sample_rate: 24000 });
    last().drop(1006);
    // attempt 1 after 1 s, attempt 2 after a further 2 s, attempt 3 after 3 s, attempt 4 after 3 s
    for (const [wait, total] of [
      [1000, 2],
      [2000, 3],
      [3000, 4],
      [3000, 5],
    ] as const) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(FakeWebSocket.instances).toHaveLength(total - 1); // not yet
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(total);
      last().drop(1006); // every attempt fails
    }
    expect(events.onLost).toHaveBeenCalledTimes(1); // out of retries
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWebSocket.instances).toHaveLength(5); // gave up
  });

  it("survives a drop of up to 10 s: a server that returns after 8 s is reconnected", async () => {
    const { sock, events } = setup();
    sock.start();
    await flush();
    last().open();
    last().server({ type: "ready", sample_rate: 24000 });
    last().drop(1006);
    let up = false;
    // keep failing every attempt until 8 s have passed since the drop
    const start = Date.now();
    for (let i = 0; i < 4 && !up; i++) {
      await vi.advanceTimersByTimeAsync(i === 0 ? 1000 : i === 1 ? 2000 : 3000);
      if (Date.now() - start >= 8000) {
        up = true;
        last().open();
        last().server({ type: "ready", sample_rate: 24000 });
      } else {
        last().drop(1006);
      }
    }
    expect(up).toBe(true);
    expect(events.onLost).not.toHaveBeenCalled();
    expect(events.onResumed).toHaveBeenCalled();
  });

  it("a successful reconnect resets the retry budget", async () => {
    const { sock, events } = setup();
    sock.start();
    await flush();
    last().open();
    last().server({ type: "ready", sample_rate: 24000 });
    for (let i = 0; i < 3; i++) {
      last().drop(1012);
      await vi.advanceTimersByTimeAsync(1000);
      last().open();
      last().server({ type: "ready", sample_rate: 24000 });
    }
    expect(events.onLost).not.toHaveBeenCalled();
  });

  it("a restarting server (1012) and upstream failure (4500) reconnect", async () => {
    for (const code of [1012, 4500]) {
      const { sock } = setup();
      sock.start();
      await flush();
      last().open();
      last().server({ type: "ready", sample_rate: 24000 });
      const before = FakeWebSocket.instances.length;
      last().drop(code);
      await vi.advanceTimersByTimeAsync(1000);
      expect(FakeWebSocket.instances.length).toBe(before + 1);
    }
  });

  it.each([4401, 4429])(
    "does not reconnect after close code %i",
    async (code) => {
      const { sock, events } = setup();
      sock.start();
      await flush();
      last().open();
      last().drop(code);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(states(events).at(-1)).toBe("closed");
      expect(events.onLost).not.toHaveBeenCalled();
    },
  );

  it("gives up if the outage exceeds the budget even with retries left", async () => {
    const { sock, events } = setup({ maxOutageMs: 500 });
    sock.start();
    await flush();
    last().open();
    last().server({ type: "ready", sample_rate: 24000 });
    last().drop(1006);
    await vi.advanceTimersByTimeAsync(1000);
    last().drop(1006); // 1 s into the outage, limit is 0.5 s
    expect(events.onLost).toHaveBeenCalled();
  });

  it("a token fetch failure counts as a failed attempt", async () => {
    const { sock, events, getToken } = setup();
    getToken.mockRejectedValue(new Error("offline"));
    sock.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events.onLost).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(5); // first try plus four retries
  });

  it("stop() tells the server, closes normally and never reconnects", async () => {
    const { sock, events } = setup();
    sock.start();
    await flush();
    last().open();
    last().server({ type: "ready", sample_rate: 24000 });
    sock.stop();
    expect(last().jsonSent()).toContainEqual({ type: "stop" });
    expect(last().closeCode).toBe(1000);
    last().drop(1000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(events.onLost).not.toHaveBeenCalled();
  });

  it("forwards server errors and the daily cap", async () => {
    const { sock, events } = setup();
    sock.start();
    await flush();
    last().open();
    last().server({
      type: "error",
      code: "upstream_error",
      message: "Transcription was interrupted.",
    });
    last().server({ type: "cap" });
    expect(events.onError).toHaveBeenCalledWith({
      code: "upstream_error",
      message: "Transcription was interrupted.",
    });
    expect(events.onCap).toHaveBeenCalled();
  });

  it("ignores garbage and binary messages", async () => {
    const { sock, events } = setup();
    sock.start();
    await flush();
    last().open();
    last().onmessage?.({ data: "not json" });
    last().onmessage?.({ data: new ArrayBuffer(4) });
    last().server({ type: "mystery" });
    expect(events.onPartial).not.toHaveBeenCalled();
  });
});
