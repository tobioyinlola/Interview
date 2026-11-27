/** Set by the desktop app's preload script (desktop/src/preload.js). Absent in a normal browser. */
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
  /** Opens the Auto-Apply workspace window (forms filled in where the person can watch). */
  openWorkspace?: (opts: { token: string; base: string }) => Promise<boolean>;
  /** Native protection for private screens (see app/privacy.ts). */
  privacy?: {
    set: (on: boolean) => Promise<{ active: boolean; reason?: string }>;
    setLive: (on: boolean) => Promise<void>;
  };
}

declare global {
  interface Window {
    interviewMeetDesktop?: DesktopBridge;
  }
}

/** True when running inside the InterviewMeet desktop app. */
export function isDesktopApp(): boolean {
  return (
    typeof window !== "undefined" &&
    window.interviewMeetDesktop?.isDesktop === true
  );
}
