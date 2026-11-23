/** Set by the desktop app's preload script (desktop/src/preload.js). Absent in a normal browser. */
interface DesktopBridge {
  isDesktop: true;
  platform: string;
  systemAudio: boolean;
  /** Opens an address in the person's normal browser (used for Google sign-in). */
  openInBrowser?: (url: string) => void;
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
