import { API_BASE_URL } from "../../api/client";
import { isDesktopApp } from "../../app/desktop";
import { isMobileApp } from "../../app/native";

const KEY = "im-app-verifier";
const MAX_AGE_MS = 10 * 60_000;

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The one-time secret for a sign-in started in this app. Handed back exactly once, and only if
 *  it is recent, so an old or replayed return link finds nothing. */
export function takeVerifier(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!raw) return null;
    const { v, t } = JSON.parse(raw) as { v: string; t: number };
    return typeof v === "string" && now - t < MAX_AGE_MS ? v : null;
  } catch {
    return null;
  }
}

/** Makes the one-time secret for a sign-in that will finish in the browser (Google, or an emailed
 *  link opened there) and keeps it in this app. Returns only its hash, the "challenge", to send ahead. */
export async function newAppChallenge(): Promise<string> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: verifier, t: Date.now() }));
  } catch {
    throw new Error("This device will not let the app save a sign-in.");
  }
  return b64url(new Uint8Array(digest));
}

interface CapacitorPlugins {
  Plugins?: {
    Browser?: { open: (o: { url: string }) => Promise<void> };
    App?: {
      addListener?: (
        name: string,
        fn: (e: { url: string }) => void,
      ) => Promise<unknown> | unknown;
    };
  };
}
export const capacitorPlugins = (): CapacitorPlugins["Plugins"] =>
  (window.Capacitor as CapacitorPlugins | undefined)?.Plugins;

/** Google will not run inside an app's own window, so in an installed app a Google page opens in
 *  the real browser; on the website it simply opens here. */
export async function openGoogleStep(url: string): Promise<void> {
  if (isDesktopApp()) window.interviewMeetDesktop?.openInBrowser?.(url);
  else if (isMobileApp()) await capacitorPlugins()?.Browser?.open({ url });
  else window.location.assign(url);
}

/** Sign in with Google from an installed app. Google refuses to run inside an app's own window, so
 *  the person signs in in the real browser, which then hands the app a one-time code through the
 *  interviewmeet:// address. The code only works together with `verifier`, which never leaves this
 *  app, so another program that catches the address gets nothing. */
export async function startNativeGoogle(extra: URLSearchParams): Promise<void> {
  const challenge = await newAppChallenge();
  const query = new URLSearchParams(extra);
  query.set("app", "1");
  query.set("challenge", challenge);
  const url = new URL(
    `${API_BASE_URL}/api/auth/google/start?${query}`,
    window.location.origin,
  ).href;
  if (isDesktopApp()) {
    window.interviewMeetDesktop?.openInBrowser?.(url);
  } else if (isMobileApp()) {
    await capacitorPlugins()?.Browser?.open({ url });
  }
}
