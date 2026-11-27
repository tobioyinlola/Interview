/** Set by the desktop app's bridge (Electron: desktop/src/preload.js, Tauri: desktop-tauri/src-tauri/bridge.js). Absent in a normal browser. */

export interface StealthState {
  active: boolean;
  clickThrough: boolean;
}

interface DesktopStealth {
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  setClickThrough: (enable: boolean) => Promise<void>;
  query: () => Promise<StealthState>;
  onStateChanged: (cb: (state: StealthState) => void) => () => void;
}

interface DesktopWindowControls {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
}

interface DesktopBridge {
  isDesktop: true;
  platform: string;
  arch?: string;
  systemAudio: boolean;
  /** Opens an address in the person's normal browser (used for Google sign-in). */
  openInBrowser?: (url: string) => void;
  /** The system file picker, starting in Downloads. Null when cancelled. */
  pickCv?: () => Promise<{
    name: string;
    data?: Uint8Array;
    tooBig?: boolean;
  } | null>;
  /** Native protection for private screens (see app/privacy.ts). */
  privacy?: {
    set: (on: boolean) => Promise<{ active: boolean; reason?: string }>;
    setLive: (on: boolean) => Promise<void>;
  };
  setStealthMode?: (enable: boolean) => Promise<{ ok: boolean; stealth: boolean }>;
  windowControl?: (action: "minimize" | "maximize" | "close") => Promise<void>;
  windowControls?: DesktopWindowControls;
  stealth?: DesktopStealth;
}

declare global {
  interface Window {
    interviewDesktop?: DesktopBridge;
    interviewMeetDesktop?: DesktopBridge;
  }
}

declare module "react" {
  interface CSSProperties {
    WebkitAppRegion?: "drag" | "no-drag";
  }
}

/** True when running inside the InterviewMeet desktop app. */
export const isDesktopApp = (): boolean =>
  typeof window !== "undefined" &&
  Boolean(window.interviewDesktop?.isDesktop ?? window.interviewMeetDesktop?.isDesktop);

export async function setDesktopStealthMode(enable: boolean): Promise<void> {
  if (window.interviewDesktop?.setStealthMode) {
    await window.interviewDesktop.setStealthMode(enable);
  } else if (window.interviewMeetDesktop?.stealth) {
    if (enable) {
      await window.interviewMeetDesktop.stealth.enter();
    } else {
      await window.interviewMeetDesktop.stealth.exit();
    }
  }
}

/** True when the desktop app supports the stealth HUD. */
export function hasStealthSupport(): boolean {
  return (
    isDesktopApp() &&
    Boolean(
      window.interviewDesktop?.setStealthMode ||
        window.interviewDesktop?.stealth ||
        window.interviewMeetDesktop?.stealth,
    )
  );
}

/** Enter stealth HUD mode — morphs the window into a compact floating overlay. */
export async function enterStealth(): Promise<void> {
  await setDesktopStealthMode(true);
}

/** Exit stealth HUD mode — restores the full desktop window. */
export async function exitStealth(): Promise<void> {
  await setDesktopStealthMode(false);
}

/** Toggle pointer-event passthrough on the HUD. */
export async function setStealthClickThrough(enable: boolean): Promise<void> {
  const stealth = window.interviewDesktop?.stealth ?? window.interviewMeetDesktop?.stealth;
  await stealth?.setClickThrough(enable);
}

/** Subscribe to stealth state changes pushed from the main process.
 *  Returns an unsubscribe function. */
export function onStealthStateChanged(
  cb: (state: StealthState) => void,
): () => void {
  const stealth = window.interviewDesktop?.stealth ?? window.interviewMeetDesktop?.stealth;
  return stealth?.onStateChanged(cb) ?? (() => {});
}

/** Minimize the desktop application window. */
export function minimizeDesktopWindow(): void {
  if (window.interviewDesktop?.windowControl) {
    void window.interviewDesktop.windowControl("minimize");
  } else {
    void (
      window.interviewDesktop?.windowControls ?? window.interviewMeetDesktop?.windowControls
    )?.minimize();
  }
}

/** Maximize or unmaximize the desktop application window. */
export function maximizeDesktopWindow(): void {
  if (window.interviewDesktop?.windowControl) {
    void window.interviewDesktop.windowControl("maximize");
  } else {
    void (
      window.interviewDesktop?.windowControls ?? window.interviewMeetDesktop?.windowControls
    )?.maximize();
  }
}

/** Close the desktop application window. */
export function closeDesktopWindow(): void {
  if (window.interviewDesktop?.windowControl) {
    void window.interviewDesktop.windowControl("close");
  } else {
    void (
      window.interviewDesktop?.windowControls ?? window.interviewMeetDesktop?.windowControls
    )?.close();
  }
}
