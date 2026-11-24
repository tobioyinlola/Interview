/** Set by the desktop app's preload script (desktop/src/preload.js). Absent in a normal browser. */

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
  /** Frameless window controls for desktop normal mode. */
  windowControls?: DesktopWindowControls;
  /** Stealth HUD controls — only usable from the live interview page. */
  stealth?: DesktopStealth;
}

declare global {
  interface Window {
    interviewMeetDesktop?: DesktopBridge;
  }
}

declare module "react" {
  interface CSSProperties {
    WebkitAppRegion?: "drag" | "no-drag";
  }
}

/** True when running inside the InterviewMeet desktop app. */
export function isDesktopApp(): boolean {
  return (
    typeof window !== "undefined" &&
    window.interviewMeetDesktop?.isDesktop === true
  );
}

/** True when the desktop app supports the stealth HUD. */
export function hasStealthSupport(): boolean {
  return isDesktopApp() && !!window.interviewMeetDesktop?.stealth;
}

/** Enter stealth HUD mode — morphs the window into a compact floating overlay. */
export async function enterStealth(): Promise<void> {
  await window.interviewMeetDesktop?.stealth?.enter();
}

/** Exit stealth HUD mode — restores the full desktop window. */
export async function exitStealth(): Promise<void> {
  await window.interviewMeetDesktop?.stealth?.exit();
}

/** Toggle pointer-event passthrough on the HUD. */
export async function setStealthClickThrough(enable: boolean): Promise<void> {
  await window.interviewMeetDesktop?.stealth?.setClickThrough(enable);
}

/** Subscribe to stealth state changes pushed from the main process.
 *  Returns an unsubscribe function. */
export function onStealthStateChanged(
  cb: (state: StealthState) => void,
): () => void {
  return window.interviewMeetDesktop?.stealth?.onStateChanged(cb) ?? (() => {});
}

/** Minimize the desktop application window. */
export function minimizeDesktopWindow(): void {
  void window.interviewMeetDesktop?.windowControls?.minimize();
}

/** Maximize or unmaximize the desktop application window. */
export function maximizeDesktopWindow(): void {
  void window.interviewMeetDesktop?.windowControls?.maximize();
}

/** Close the desktop application window. */
export function closeDesktopWindow(): void {
  void window.interviewMeetDesktop?.windowControls?.close();
}
