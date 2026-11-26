import { isDesktopApp } from "../app/desktop";
import { RUNNING_UI } from "../app/liveUpdate";
import { isMobileApp } from "../app/native";

/** Which device and shell this is, in the plain terms the usage statistics use. */

export type Platform =
  "web" | "windows" | "macos" | "linux" | "android" | "ios";
export type FormFactor = "phone" | "tablet" | "desktop";
export type Viewport = "xs" | "sm" | "md" | "lg" | "xl";

export function platform(): Platform {
  if (isDesktopApp()) {
    const p = window.interviewMeetDesktop?.platform;
    return p === "darwin" ? "macos" : p === "linux" ? "linux" : "windows";
  }
  if (isMobileApp()) {
    return window.Capacitor?.getPlatform?.() === "ios" ? "ios" : "android";
  }
  return "web";
}

export function viewport(width = window.innerWidth): Viewport {
  if (width < 640) return "xs";
  if (width < 768) return "sm";
  if (width < 1024) return "md";
  if (width < 1280) return "lg";
  return "xl";
}

/** Phone, tablet or computer: by the screen the interface is drawn on, and whether it is touched. */
export function formFactor(): FormFactor {
  if (isDesktopApp()) return "desktop";
  const w = window.innerWidth;
  if (w < 768) return "phone";
  let touch = false;
  try {
    touch = window.matchMedia?.("(pointer: coarse)").matches === true;
  } catch {
    /* no media queries: judge by width alone */
  }
  return touch && w < 1400 ? "tablet" : w < 1024 ? "tablet" : "desktop";
}

export const appVersion = (): string => RUNNING_UI;
export const locale = (): string => navigator.language ?? "";
