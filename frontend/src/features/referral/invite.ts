/** The invite code a person arrived with (`?ref=` in a link). It is kept in the browser so it is
 *  still there when they get to the sign-up form, whichever page they landed on first. */
const KEY = "meet-practice-invite";
const VALID = /^[a-z0-9]{4,16}$/;

const clean = (raw: string | null | undefined): string | null => {
  const code = (raw ?? "").trim().toLowerCase();
  return VALID.test(code) ? code : null;
};

/** Remember the code in the current address, if there is one. Call once when the app starts. */
export function captureInvite(search = window.location.search): void {
  const code = clean(new URLSearchParams(search).get("ref"));
  if (!code) return;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* storage can be blocked: the code just is not kept */
  }
}

/** The remembered code, or undefined. */
export function savedInvite(): string | undefined {
  try {
    return clean(localStorage.getItem(KEY)) ?? undefined;
  } catch {
    return undefined;
  }
}
