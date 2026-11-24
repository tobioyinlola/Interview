import { useCallback, useEffect, useRef, useState } from "react";
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

/** Hook for the live interview page to control the Electron stealth HUD.
 *
 *  - Subscribes to main-process push events so React state stays in sync.
 *  - Cleans up (exits stealth) on unmount so a component teardown or error
 *    can never leave the user trapped in a frameless HUD. */
export function useStealthHud(): StealthHudControls {
  const supported = hasStealthSupport();
  const [state, setState] = useState<StealthState>(DEFAULT_STATE);
  // Track whether *this* hook entered stealth so cleanup only exits when needed.
  const enteredRef = useRef(false);

  useEffect(() => {
    if (!supported) return;
    // Subscribe to main-process push updates.
    const unsub = onStealthStateChanged((s) => setState(s));
    return unsub;
  }, [supported]);

  // Safety net: if the page unmounts while in stealth, restore the window.
  useEffect(() => {
    return () => {
      if (enteredRef.current) {
        void exitStealth();
        enteredRef.current = false;
      }
    };
  }, []);

  const enter = useCallback(async () => {
    if (!supported) return;
    enteredRef.current = true;
    await enterStealth();
  }, [supported]);

  const exit = useCallback(async () => {
    if (!supported) return;
    enteredRef.current = false;
    await exitStealth();
  }, [supported]);

  const toggleClickThrough = useCallback(async () => {
    if (!supported) return;
    await setStealthClickThrough(!state.clickThrough);
  }, [supported, state.clickThrough]);

  return { supported, state, enter, exit, toggleClickThrough };
}
