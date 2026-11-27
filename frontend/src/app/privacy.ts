/** Privacy for private screens (account settings, CV, profile facts, mailbox passwords, the back
 *  office), with one adapter per platform:
 *
 *  - Windows and macOS (desktop app): the window's native content protection, through Electron's
 *    setContentProtection. On Windows it keeps the window out of screenshots, screen recording and
 *    screen sharing where Windows supports it; on macOS it covers capture through the older
 *    screen-capture paths but not every recorder (newer capture frameworks can still see it).
 *  - Android: the secure-window flag. Screenshots, screen recordings, screen sharing and the
 *    recent-apps preview show a blank screen instead of the page.
 *  - iPhone: iOS cannot stop screenshots or exclude part of a screen. When the system says the
 *    screen is being recorded or mirrored, private content is hidden on screen, and the
 *    app-switcher preview is covered.
 *  - A website: browsers offer nothing; Presentation mode hides personal details by hand.
 *
 *  On desktop, protection is always on — the app must stay hidden from screen capture at all
 *  times (see AGENTS.md). On mobile, protection is off during a live interview session so the
 *  user can cast or record their own screen. */

import { create } from "zustand";

import { isDesktopApp } from "./desktop";
import { isMobileApp } from "./native";

export type Platform =
  "windows" | "macos" | "linux" | "android" | "ios" | "web";

export interface Capability {
  platform: Platform;
  /** What the operating system can do for private screens. */
  method: "exclude" | "secure-window" | "detect-and-hide" | "none";
  summary: string;
  limits: string[];
}

interface MobilePrivacyPlugin {
  setProtected(o: { on: boolean }): Promise<{ active: boolean }>;
  addListener?(
    event: "captureChanged",
    fn: (e: { captured: boolean }) => void,
  ): Promise<{ remove: () => void }> | { remove: () => void };
}

function mobilePlugin(): MobilePrivacyPlugin | undefined {
  const plugins = (
    window.Capacitor as unknown as
      { Plugins?: { Privacy?: MobilePrivacyPlugin } } | undefined
  )?.Plugins;
  return plugins?.Privacy;
}

export function platform(): Platform {
  if (isDesktopApp()) {
    const p = window.interviewMeetDesktop?.platform;
    return p === "win32" ? "windows" : p === "darwin" ? "macos" : "linux";
  }
  if (isMobileApp()) {
    const p = (
      window.Capacitor as { getPlatform?: () => string }
    ).getPlatform?.();
    return p === "ios" ? "ios" : "android";
  }
  return "web";
}

export function capability(p: Platform = platform()): Capability {
  switch (p) {
    case "windows":
      return {
        platform: p,
        method: "exclude",
        summary:
          "Private screens are kept out of screenshots, recordings and screen sharing.",
        limits: [
          "Needs Windows 10 version 2004 or later; older Windows shows the window as a black box instead.",
          "Not yet checked against every meeting and recording app.",
        ],
      };
    case "macos":
      return {
        platform: p,
        method: "exclude",
        summary: "Private screens ask macOS not to share their window.",
        limits: [
          "Recording and sharing apps built on Apple's newer capture system can still show it.",
          "Use Presentation mode when you share your screen on a Mac.",
        ],
      };
    case "android":
      return {
        platform: p,
        method: "secure-window",
        summary:
          "Private screens show blank in screenshots, recordings, screen sharing and recent apps.",
        limits: ["Some manufacturers' tools may behave differently."],
      };
    case "ios":
      return {
        platform: p,
        method: "detect-and-hide",
        summary:
          "Private screens hide their content while the screen is being recorded or mirrored, and in the app switcher.",
        limits: [
          "iOS cannot stop screenshots.",
          "Content is hidden only once iOS reports the recording or mirroring.",
        ],
      };
    case "linux":
      return {
        platform: p,
        method: "none",
        summary: "Linux offers no way to keep a window out of capture.",
        limits: ["Use Presentation mode when you share your screen."],
      };
    default:
      return {
        platform: p,
        method: "none",
        summary: "A browser cannot keep a page out of screen capture.",
        limits: ["Use Presentation mode when you share your screen."],
      };
  }
}

const KEY = "im-privacy";
const saved = (): { enabled: boolean; presentation: boolean } => {
  try {
    return {
      enabled: true,
      presentation: false,
      ...JSON.parse(localStorage.getItem(KEY) || "{}"),
    };
  } catch {
    return { enabled: true, presentation: false };
  }
};

export interface PrivacyState {
  /** The person's choice: protect private screens (on by default). */
  enabled: boolean;
  /** Hide personal details everywhere, by hand, for sharing a screen. */
  presentation: boolean;
  /** A live interview session is open: protection stays off. */
  live: boolean;
  /** How many private screens are open right now. */
  open: number;
  /** Native protection is actually on. */
  active: boolean;
  /** iPhone: the screen is being recorded or mirrored. */
  captured: boolean;
  problem: string | null;
}

export const usePrivacy = create<PrivacyState>(() => ({
  ...saved(),
  live: false,
  open: 0,
  active: false,
  captured: false,
  problem: null,
}));

function remember(): void {
  const { enabled, presentation } = usePrivacy.getState();
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled, presentation }));
  } catch {
    /* a preference, not a guarantee */
  }
}

/** Whether native protection should be on now.
 *  Desktop: always on when enabled (AGENTS.md mandate).
 *  Mobile: off during a live session so the user can cast/record. */
export function wanted(
  s: Pick<PrivacyState, "enabled" | "live" | "open">,
): boolean {
  if (isDesktopApp()) return s.enabled;
  return s.enabled && !s.live && s.open > 0;
}

let applying: Promise<void> = Promise.resolve();

async function apply(): Promise<void> {
  const on = wanted(usePrivacy.getState());
  try {
    let active = false;
    if (isDesktopApp() && window.interviewMeetDesktop?.privacy) {
      active = (await window.interviewMeetDesktop.privacy.set(on)).active;
    } else if (isMobileApp() && mobilePlugin()) {
      active = (await mobilePlugin()!.setProtected({ on })).active;
    }
    usePrivacy.setState({ active, problem: null });
  } catch {
    usePrivacy.setState({
      active: false,
      problem:
        "Screen protection could not be switched on. Use Presentation mode if you are sharing.",
    });
  }
}

function update(patch: Partial<PrivacyState>): void {
  usePrivacy.setState(patch);
  applying = applying.then(apply); // one change at a time, in order
}

export const privacy = {
  enterPrivate: () => update({ open: usePrivacy.getState().open + 1 }),
  leavePrivate: () =>
    update({ open: Math.max(0, usePrivacy.getState().open - 1) }),
  setLive: (on: boolean) => {
    update({ live: on });
    void window.interviewMeetDesktop?.privacy?.setLive(on);
  },
  setEnabled: (on: boolean) => {
    update({ enabled: on });
    remember();
  },
  setPresentation: (on: boolean) => {
    usePrivacy.setState({ presentation: on });
    remember();
  },
  /** Wait for the last change to reach the operating system (tests). */
  settled: () => applying,
};

let listening = false;
/** iPhone: follow the system's "screen is being recorded or mirrored" signal. Call once. */
export function watchCapture(): void {
  const plugin = mobilePlugin();
  if (listening || platform() !== "ios" || !plugin?.addListener) return;
  listening = true;
  void plugin.addListener("captureChanged", (e) =>
    usePrivacy.setState({ captured: e.captured }),
  );
}
