import { useCallback, useEffect, useState } from "react";
import {
  enterStealth,
  exitStealth,
  hasStealthSupport,
  onStealthStateChanged,
  setStealthClickThrough,
  type StealthState,
} from "../../app/desktop";

export interface StealthHudControls {
  /** Whether the Electron desktop app supports dynamic stealth mode. */
  supported: boolean;
  /** Current stealth / HUD state synced with the main process. */
  state: StealthState;
  /** Morph the window into the floating HUD and hide it from screen-share. */
  enter: () => Promise<void>;
  /** Restore the full desktop window. */
  exit: () => Promise<void>;
  /** Toggle pointer passthrough (click-through mode). */
  toggleClickThrough: () => Promise<void>;
}

const DEFAULT_STATE: StealthState = { active: false, clickThrough: false };

let globalStealthState: StealthState = DEFAULT_STATE;
const listeners = new Set<(s: StealthState) => void>();

if (typeof window !== "undefined") {
  onStealthStateChanged((s) => {
    globalStealthState = s;
    listeners.forEach((l) => l(s));
  });
  void window.interviewMeetDesktop?.stealth?.query().then((s) => {
    if (s) {
      globalStealthState = s;
      listeners.forEach((l) => l(s));
    }
  });
}

/** Hook for the live interview page to control the Electron stealth HUD.
 *
 *  - Subscribes to main-process push events so React state stays in sync.
 *  - Queries initial state on mount so it never falls out of sync.
 */
export function useStealthHud(): StealthHudControls {
  const supported = hasStealthSupport();
  const [state, setState] = useState<StealthState>(globalStealthState);

  useEffect(() => {
    if (!supported) return;

    listeners.add(setState);
    setState(globalStealthState);

    // Check initial state from main process on mount
    void window.interviewMeetDesktop?.stealth?.query().then((s) => {
      if (s) {
        globalStealthState = s;
        setState(s);
      }
    });

    return () => {
      listeners.delete(setState);
    };
  }, [supported]);

  const enter = useCallback(async () => {
    if (!supported) return;
    await enterStealth();
  }, [supported]);

  const exit = useCallback(async () => {
    if (!supported) return;
    await exitStealth();
  }, [supported]);

  const toggleClickThrough = useCallback(async () => {
    if (!supported) return;
    await setStealthClickThrough(!state.clickThrough);
  }, [supported, state.clickThrough]);

  return { supported, state, enter, exit, toggleClickThrough };
}
