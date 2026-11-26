import { startCapture } from "./capture";
import { persist, restore, track } from "./client";
import { startEngagement } from "./engagement";

export { setScreen, cleanRoute } from "./engagement";
export { setOptOut, isOptedOut, enabled, track } from "./client";

/** The features that can be reported. Fixed on purpose: a value that is chosen from this list can
 *  never be text a person wrote. */
export type Feature =
  | "signup_submit"
  | "login_submit"
  | "cv_upload"
  | "cv_remove"
  | "company_add"
  | "interview_start"
  | "interview_end"
  | "answer_rate"
  | "autoapply_enable"
  | "autoapply_pause"
  | "autoapply_applied_by_you"
  | "outreach_request"
  | "referral_copy"
  | "app_update"
  | "privacy_toggle"
  | "screen_protection";

/** A feature was used. `detail` and `mode` are codes you choose, never what a person typed. */
export function trackFeature(
  feature: Feature,
  extra?: { detail?: string; mode?: string },
): void {
  track("feature_used", { feature, ...extra });
}

/** A step of a guided flow was shown ("onboarding", "autoapply_setup"). `step` is a code. */
export function trackStep(
  flow: "onboarding" | "autoapply_setup" | "interview_setup",
  step: string,
): void {
  track("step_view", { feature: flow, step });
}

/** Start everything for this launch of the app. Returns the way to stop it. */
export function startAnalytics(): () => void {
  restore();
  const stopEngagement = startEngagement();
  const stopCapture = startCapture();
  return () => {
    stopEngagement();
    stopCapture();
    persist();
  };
}
