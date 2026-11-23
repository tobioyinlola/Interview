import { isDesktopApp } from "./desktop";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

/** True inside the InterviewMeet phone app (the Capacitor shell injects `window.Capacitor`). */
export function isMobileApp(): boolean {
  return (
    typeof window !== "undefined" &&
    window.Capacitor?.isNativePlatform?.() === true
  );
}

/** Either native shell. Google blocks its sign-in inside embedded web views, so both hide it. */
export function isNativeApp(): boolean {
  return isDesktopApp() || isMobileApp();
}
