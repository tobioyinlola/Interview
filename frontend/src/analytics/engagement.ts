import { flush, persist, setRoute, track } from "./client";
import { touchVisit } from "./ids";

/** Time really spent, and the app coming and going.
 *
 *  A screen is "engaged with" only while the app is in front AND the person did something in the
 *  last 30 seconds (touch, click, key, scroll). Leaving a tab open does not count. The live
 *  interview is the exception: there the person listens rather than clicks, so being in front is
 *  enough. Nothing here records what was touched, only that something was. */

const ACTIVE_WINDOW_MS = 30_000;
const TICK_MS = 1000;
const WATCHING = /^\/session\/:id$/;

/** A path as a pattern: ids and long tokens become ":id" (the server does the same). */
export function cleanRoute(path: string): string {
  const bare = path.split("?")[0]!.split("#")[0]!.toLowerCase();
  const parts = bare
    .replace(/\/+$/, "")
    .split("/")
    .map((p) =>
      /^(?:[0-9a-f]{8}-[0-9a-f-]{27}|[0-9]{3,}|[0-9a-f]{16,}|[a-z0-9_-]{24,})$/.test(
        p,
      )
        ? ":id"
        : p,
    );
  return parts.join("/").slice(0, 80) || "/";
}

let screen: { route: string; ms: number } | null = null;
let foregroundMs = 0;
let lastInput = 0;
let lastTick = 0;

const inFront = (): boolean => document.visibilityState !== "hidden";

function tick(): void {
  const now = Date.now();
  const spent = Math.min(2 * TICK_MS, now - lastTick); // a sleeping laptop does not add hours
  lastTick = now;
  if (!screen || !inFront()) return;
  if (now - lastInput < ACTIVE_WINDOW_MS || WATCHING.test(screen.route)) {
    screen.ms += spent;
    foregroundMs += spent;
  }
}

function leaveScreen(): void {
  if (screen && screen.ms >= 1000)
    track(
      "screen_engaged",
      { seconds: Math.round(screen.ms / 1000) },
      screen.route,
    );
  if (screen) screen.ms = 0;
}

/** A new screen: close the last one's time, then count the view. `null` is a place we do not measure. */
export function setScreen(route: string | null): void {
  leaveScreen();
  screen = route ? { route, ms: 0 } : null;
  setRoute(route ?? undefined);
  if (route) track("screen_view", undefined, route);
}

let wentAway = false;
function away(): void {
  if (wentAway) return;
  wentAway = true;
  leaveScreen();
  track("app_background", { seconds: Math.round(foregroundMs / 1000) });
  foregroundMs = 0;
  persist(); // in case the app is killed before the next launch can send it
  void flush(true);
}
function back(): void {
  if (!wentAway) return;
  wentAway = false;
  lastInput = Date.now();
  lastTick = lastInput;
  const { fresh } = touchVisit();
  if (fresh) track("app_open", { source: "resume" });
  track("app_foreground");
}

export function startEngagement(): () => void {
  const now = Date.now();
  lastInput = now;
  lastTick = now;
  wentAway = false;
  foregroundMs = 0;
  screen = null;
  track("app_open", { source: touchVisit().fresh ? "cold" : "resume" });
  const input = () => {
    lastInput = Date.now();
  };
  const visibility = () => (inFront() ? back() : away());
  const options = { passive: true, capture: true } as const;
  const inputs = [
    "pointerdown",
    "keydown",
    "touchstart",
    "scroll",
    "wheel",
  ] as const;
  inputs.forEach((e) => window.addEventListener(e, input, options));
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", away);
  window.addEventListener("pageshow", back);
  const timer = setInterval(tick, TICK_MS);
  return () => {
    clearInterval(timer);
    inputs.forEach((e) => window.removeEventListener(e, input, options));
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", away);
    window.removeEventListener("pageshow", back);
    screen = null;
  };
}
