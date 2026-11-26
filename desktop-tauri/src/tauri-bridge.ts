/**
 * Tauri Bridge — replaces Electron's preload.js
 *
 * Provides the same `window.interviewDesktop` / `window.interviewMeetDesktop` API
 * that the React frontend expects, but backed by Tauri's invoke() and event system.
 *
 * Usage: import this file early in the app's entry point (main.tsx or similar).
 * It will detect whether it's running inside Tauri and set up the bridge accordingly.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface StealthState {
  active: boolean;
  clickThrough: boolean;
}

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  arch?: string;
  systemAudio: boolean;
  openInBrowser: (url: string) => void;
  setStealthMode: (enable: boolean) => Promise<{ ok: boolean; stealth: boolean }>;
  windowControl: (action: string) => Promise<void>;
  windowControls: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
  };
  stealth: {
    enter: () => Promise<void>;
    exit: () => Promise<void>;
    setClickThrough: (enable: boolean) => Promise<void>;
    query: () => Promise<StealthState>;
    onStateChanged: (cb: (state: StealthState) => void) => () => void;
  };
}

/** Detect if running inside Tauri */
function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** Get the platform name in Electron format */
function getPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "win32";
  if (ua.includes("mac")) return "darwin";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

function createTauriBridge(): DesktopBridge {
  return Object.freeze({
    isDesktop: true as const,
    platform: getPlatform(),
    systemAudio: true,

    openInBrowser: (url: string) => {
      if (typeof url === "string") {
        invoke("plugin:opener|open_url", { url }).catch(console.error);
      }
    },

    setStealthMode: async (enable: boolean) => {
      await invoke("stealth_set_mode", { enable });
      return { ok: true, stealth: enable };
    },

    windowControl: async (action: string) => {
      if (action === "minimize") await invoke("window_minimize");
      else if (action === "maximize") await invoke("window_maximize");
      else if (action === "close") await invoke("window_close");
    },

    windowControls: {
      minimize: () => invoke("window_minimize"),
      maximize: () => invoke("window_maximize"),
      close: () => invoke("window_close"),
    },

    stealth: {
      enter: () => invoke("stealth_enter"),
      exit: () => invoke("stealth_exit"),
      setClickThrough: (enable: boolean) =>
        invoke("stealth_set_click_through", { enable }),
      query: () => invoke<StealthState>("stealth_query"),
      onStateChanged: (cb: (state: StealthState) => void) => {
        let unlisten: UnlistenFn | null = null;

        listen<StealthState>("stealth-state", (event) => {
          // Map from Rust snake_case to JS camelCase
          cb({
            active: event.payload.active,
            clickThrough: (event.payload as any).click_through ?? event.payload.clickThrough,
          });
        }).then((fn_) => {
          unlisten = fn_;
        });

        // Return unsubscribe function (same API as Electron version)
        return () => {
          if (unlisten) unlisten();
        };
      },
    },
  });
}

// ─── Auto-install the bridge on the window object ───

if (isTauri()) {
  const bridge = createTauriBridge();
  (window as any).interviewDesktop = bridge;
  (window as any).interviewMeetDesktop = bridge;
  console.log("[TauriBridge] Desktop bridge installed (Tauri 2)");
}

export { isTauri, createTauriBridge };
