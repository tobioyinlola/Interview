import { API_BASE_URL } from "../api/client";
import { authInit } from "../api/session";
import { appVersion, formFactor, locale, platform, viewport } from "./context";
import { deviceId, touchVisit } from "./ids";

/** Usage statistics: a queue of small events, sent in batches to our own server.
 *
 *  What makes it safe to run on every device:
 *  - An event is a name from a fixed list, a route with its ids removed, and a few short coded values
 *    or numbers. There is no way to attach text a person typed, said or was shown; the server drops
 *    anything else.
 *  - It stops by itself when the person turned statistics off in Settings, or the browser says Do Not
 *    Track / Global Privacy Control, and the server checks those again.
 *  - It never gets in the way: no event waits on the network, a failure is retried later, and a
 *    device with no connection keeps a small bounded queue for when it comes back. */

export type EventName =
  | "app_open"
  | "app_foreground"
  | "app_background"
  | "screen_view"
  | "screen_engaged"
  | "interaction"
  | "feature_used"
  | "step_view"
  | "ui_error"
  | "app_loaded"
  | "connectivity";

export type Props = Partial<
  Record<
    | "source"
    | "ev"
    | "feature"
    | "detail"
    | "step"
    | "kind"
    | "state"
    | "mode"
    | "tab"
    | "seconds"
    | "ms",
    string | number
  >
>;

interface Queued {
  name: EventName;
  ts: number;
  route?: string;
  props?: Props;
  sid: string;
}

const FLUSH_EVERY_MS = 15_000;
const FLUSH_AT = 20;
const MAX_BATCH = 50;
const MAX_QUEUE = 300;
const MAX_AGE_MS = 24 * 3600 * 1000;
const QUEUE_KEY = "im-analytics-queue";
const OFF_KEY = "im-analytics-off";

let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
let failures = 0;
let halted = false; // the server said stop (opted out, or the browser asked not to be tracked)
let route: string | undefined;

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null): void {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* not remembered */
    }
  },
};

/** The browser's own request not to be tracked. */
export function browserSaysNo(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const w = window as Window & { doNotTrack?: string };
  return (
    nav.globalPrivacyControl === true ||
    nav.doNotTrack === "1" ||
    w.doNotTrack === "1"
  );
}

export const isOptedOut = (): boolean => store.get(OFF_KEY) === "1";

export function enabled(): boolean {
  return !halted && !isOptedOut() && !browserSaysNo();
}

/** The person's choice in Settings (and, once signed in, what their account says on every device).
 *  Turning off also throws away anything still waiting to be sent. */
export function setOptOut(off: boolean): void {
  store.set(OFF_KEY, off ? "1" : null);
  if (off) {
    queue = [];
    store.set(QUEUE_KEY, null);
    if (timer) clearTimeout(timer);
    timer = undefined;
  } else {
    halted = false;
  }
}

export function setRoute(next: string | undefined): void {
  route = next;
}
export const currentRoute = (): string | undefined => route;

export function track(
  name: EventName,
  props?: Props,
  at: string | undefined = route,
): void {
  if (!enabled()) return;
  const { id } = touchVisit();
  if (queue.length >= MAX_QUEUE) queue.shift(); // the oldest is the least useful
  queue.push({
    name,
    ts: Date.now(),
    ...(at ? { route: at } : {}),
    ...(props && Object.keys(props).length ? { props } : {}),
    sid: id,
  });
  if (queue.length >= FLUSH_AT) void flush();
  else schedule();
}

function schedule(delay = FLUSH_EVERY_MS): void {
  if (timer || !queue.length) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, delay);
}

/** Send what is waiting. `leaving` sends even as the page closes (the request is allowed to outlive it). */
export async function flush(leaving = false): Promise<void> {
  if (sending || !queue.length || !enabled()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    schedule(FLUSH_EVERY_MS * 2);
    return;
  }
  const now = Date.now();
  queue = queue.filter((e) => now - e.ts < MAX_AGE_MS);
  if (!queue.length) return;
  const sid = queue[0]!.sid;
  const batch: Queued[] = [];
  for (const e of queue) {
    if (e.sid !== sid || batch.length >= MAX_BATCH) break;
    batch.push(e);
  }
  const body = JSON.stringify({
    device_id: deviceId(),
    session_id: sid,
    platform: platform(),
    form_factor: formFactor(),
    app_version: appVersion(),
    locale: locale(),
    viewport: viewport(),
    events: batch.map(({ name, ts, route: r, props }) => ({
      name,
      ts,
      ...(r ? { route: r } : {}),
      ...(props ? { props } : {}),
    })),
  });
  sending = true;
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/analytics/events`,
      authInit({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "meet-practice",
        },
        body,
        keepalive: leaving && body.length < 60_000,
      }),
    );
    if (res.ok) {
      queue = queue.filter((e) => !batch.includes(e));
      failures = 0;
      const out = (await res.json().catch(() => ({}))) as { stop?: boolean };
      if (out.stop) {
        halted = true; // until the app is reopened or the setting is changed
        queue = [];
      }
    } else if (res.status === 429 || res.status >= 500) {
      failures += 1;
    } else {
      queue = queue.filter((e) => !batch.includes(e)); // refused for good: do not resend it
    }
  } catch {
    failures += 1; // no connection: try again later
  } finally {
    sending = false;
  }
  if (queue.length)
    schedule(
      failures
        ? Math.min(5 * 60_000, FLUSH_EVERY_MS * 2 ** Math.min(failures, 5))
        : 1000,
    );
}

/** Keep what has not been sent through a close or a kill, and pick it up on the next launch. */
export function persist(): void {
  if (!queue.length) return store.set(QUEUE_KEY, null);
  store.set(QUEUE_KEY, JSON.stringify(queue.slice(-100)));
}

export function restore(): void {
  const raw = store.get(QUEUE_KEY);
  if (!raw) return;
  store.set(QUEUE_KEY, null);
  try {
    const now = Date.now();
    const saved = (JSON.parse(raw) as Queued[]).filter(
      (e) =>
        e &&
        typeof e.name === "string" &&
        typeof e.sid === "string" &&
        now - e.ts < MAX_AGE_MS,
    );
    queue = [...saved, ...queue].slice(-MAX_QUEUE);
    if (queue.length) schedule(2000);
  } catch {
    /* a damaged queue is simply dropped */
  }
}

/** For tests. */
export function resetClient(): void {
  queue = [];
  if (timer) clearTimeout(timer);
  timer = undefined;
  sending = false;
  failures = 0;
  halted = false;
  route = undefined;
}
export const queued = (): readonly Queued[] => queue;
