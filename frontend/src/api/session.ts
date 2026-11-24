/** How the app proves who is signed in.
 *
 *  The website uses the browser's session cookie. The installed apps carry their own copy of the
 *  interface (so it opens instantly and with no internet), which makes them a different origin from
 *  the API: a cookie would be cross-site and unreliable. They keep a bearer token instead, asked for
 *  with `x-client: app` and sent as `Authorization: Bearer`. The token lives in the app's private
 *  storage and is removed on sign-out. */

/** True in the build that is packed inside the Windows, Mac and phone apps. */
export const APP_SHELL: boolean = import.meta.env.VITE_APP_SHELL === "1";

const KEY = "im-session-token";
let token: string | null = null;

type Prefs = {
  get?: (o: { key: string }) => Promise<{ value: string | null }>;
  set?: (o: { key: string; value: string }) => Promise<void>;
  remove?: (o: { key: string }) => Promise<void>;
};
const prefs = (): Prefs | undefined =>
  (window as { Capacitor?: { Plugins?: { Preferences?: Prefs } } }).Capacitor
    ?.Plugins?.Preferences;

/** Read the saved token before the first screen, so a returning person is already signed in. */
export async function loadSession(): Promise<void> {
  if (!APP_SHELL) return;
  try {
    const p = prefs();
    token = p?.get
      ? ((await p.get({ key: KEY })).value ?? null)
      : localStorage.getItem(KEY);
  } catch {
    token = null;
  }
}

export function setSessionToken(next: string | null): void {
  if (!APP_SHELL || next === token) return;
  token = next;
  try {
    const p = prefs();
    if (p?.set && p.remove) {
      void (next ? p.set({ key: KEY, value: next }) : p.remove({ key: KEY }));
    } else if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the person signs in again next launch */
  }
}

export const hasSessionToken = () => token !== null;

/** Headers and credentials for a request to the API, whichever shell this is. */
export function authInit(init: RequestInit = {}): RequestInit {
  if (!APP_SHELL) return { ...init, credentials: "include" };
  const headers = new Headers(init.headers);
  headers.set("x-client", "app");
  if (token) headers.set("authorization", `Bearer ${token}`);
  return { ...init, headers, credentials: "omit" };
}

/** A new token arrives on the response headers (sign-in, and a password change). */
export function takeSessionToken(res: Response): void {
  const fresh = res.headers.get("x-session-token");
  if (fresh) setSessionToken(fresh);
}
