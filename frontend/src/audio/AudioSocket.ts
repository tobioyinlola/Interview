import { API_BASE_URL, socketBase } from "../api/client";

export interface FinalCaption {
  id: string;
  seq: number;
  speaker: "partner" | "you";
  text: string;
  ended_at: string;
}
export type SocketState =
  "idle" | "connecting" | "ready" | "reconnecting" | "closed";
export interface SocketError {
  code: string;
  message: string;
}

export interface SocketEvents {
  onState: (s: SocketState) => void;
  onReady: (sampleRate: number) => void;
  onPartial: (text: string) => void;
  onFinal: (f: FinalCaption) => void;
  /** A message from the server worth showing (the socket then closes or reconnects). */
  onError: (e: SocketError) => void;
  /** The daily audio limit was reached. */
  onCap: () => void;
  /** Audio was missed while reconnecting (ms), so the transcript can mark the gap. */
  onResumed: (gapMs: number) => void;
  /** Reconnecting did not work: capture is lost. */
  onLost: () => void;
}

export interface SocketOptions {
  sessionId: string;
  speaker?: "partner" | "you";
  /** A fresh single-use token for every connection attempt. */
  getToken: () => Promise<string>;
  WebSocketImpl?: typeof WebSocket;
  baseUrl?: string;
  maxRetries?: number;
  backoffMs?: number[];
  /** A drop of this length or less is survived; a longer one ends capture (ms). */
  maxOutageMs?: number;
  now?: () => number;
}

const NO_RECONNECT = new Set([4401, 4429]);

/** Reliability target: a network drop of 10 s or less is survived. Retries (1 s, 2 s, then 3 s apart)
 *  therefore continue until that outage budget is spent, which is why the retry count is not 2 (two
 *  retries would cover only 3 s).
 *
 * One WebSocket per audio source. Sends the token as the FIRST MESSAGE (never in the URL), waits
 *  for "ready", then streams binary PCM frames. Reconnects with backoff while the outage is
 *  within budget; a longer one is reported as capture lost. */
export class AudioSocket {
  private ws: WebSocket | null = null;
  private state: SocketState = "idle";
  private stopping = false;
  private retries = 0;
  private outageStart: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly o: Required<Omit<SocketOptions, "WebSocketImpl">> & {
    WebSocketImpl: typeof WebSocket;
  };

  constructor(
    opts: SocketOptions,
    private readonly ev: SocketEvents,
  ) {
    const wsBase = socketBase(opts.baseUrl ?? API_BASE_URL);
    this.o = {
      speaker: "partner",
      WebSocketImpl: opts.WebSocketImpl ?? WebSocket,
      baseUrl: wsBase,
      maxRetries: 4,
      backoffMs: [1000, 2000, 3000],
      maxOutageMs: 10_000,
      now: () => Date.now(),
      ...opts,
    };
    this.o.baseUrl = wsBase;
  }

  get isReady(): boolean {
    return this.state === "ready";
  }

  start(): void {
    void this.attempt();
  }

  /** Send one PCM frame. Frames are dropped (not queued) while not connected: old audio is no use. */
  sendAudio(frame: ArrayBuffer): boolean {
    if (this.state !== "ready" || !this.ws || this.ws.readyState !== 1)
      return false;
    this.ws.send(frame);
    return true;
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      if (this.ws && this.ws.readyState === 1)
        this.ws.send(JSON.stringify({ type: "stop" }));
      this.ws?.close(1000);
    } catch {
      /* already closed */
    }
    this.setState("closed");
  }

  private setState(s: SocketState) {
    if (this.state === s) return;
    this.state = s;
    this.ev.onState(s);
  }

  private async attempt(): Promise<void> {
    if (this.stopping) return;
    this.setState(
      this.retries === 0 && this.outageStart === null
        ? "connecting"
        : "reconnecting",
    );
    let token: string;
    try {
      token = await this.o.getToken();
    } catch {
      this.dropped(1006);
      return;
    }
    if (this.stopping) return;
    const url = `${this.o.baseUrl}/api/sessions/${this.o.sessionId}/audio?speaker=${this.o.speaker}`;
    const ws = new this.o.WebSocketImpl(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
    ws.onmessage = (m) => this.onMessage(ws, m.data);
    ws.onclose = (e) => {
      if (this.ws === ws) this.dropped(e.code);
    };
    ws.onerror = () => undefined; // onclose follows and carries the code
  }

  private onMessage(ws: WebSocket, data: unknown): void {
    if (typeof data !== "string") return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "ready": {
        const gap =
          this.outageStart === null ? 0 : this.o.now() - this.outageStart;
        const resumed = this.outageStart !== null;
        this.retries = 0;
        this.outageStart = null;
        this.setState("ready");
        this.ev.onReady(Number(msg.sample_rate));
        if (resumed) this.ev.onResumed(gap);
        break;
      }
      case "partial":
        this.ev.onPartial(String(msg.text ?? ""));
        break;
      case "final":
        this.ev.onFinal(msg as unknown as FinalCaption);
        break;
      case "ping":
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: "pong" }));
        break;
      case "cap":
        this.ev.onCap();
        break;
      case "error":
        this.ev.onError({
          code: String(msg.code ?? "error"),
          message: String(msg.message ?? ""),
        });
        break;
    }
  }

  private dropped(code: number): void {
    this.ws = null;
    if (this.stopping) {
      this.setState("closed");
      return;
    }
    if (NO_RECONNECT.has(code)) {
      this.setState("closed"); // bad token or daily cap: reconnecting would not help
      return;
    }
    const now = this.o.now();
    if (this.outageStart === null) this.outageStart = now;
    if (
      this.retries >= this.o.maxRetries ||
      now - this.outageStart > this.o.maxOutageMs
    ) {
      this.setState("closed");
      this.ev.onLost();
      return;
    }
    const wait =
      this.o.backoffMs[Math.min(this.retries, this.o.backoffMs.length - 1)];
    this.retries += 1;
    this.setState("reconnecting");
    this.timer = setTimeout(() => void this.attempt(), wait);
  }
}
