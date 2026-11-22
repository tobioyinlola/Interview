/** The invite code a person arrived with (`?ref=` in a link). It is kept in the browser so it is
 *  still there when they get to the sign-up form, whichever page they landed on first. */
const KEY = "meet-practice-invite";
const VALID = /^[a-z0-9]{4,16}$/;

const clean = (raw: string | null | undefined): string | null => {
  const code = (raw ?? "").trim().toLowerCase();
  return VALID.test(code) ? code : null;
};

const UTM_KEY = "meet-practice-utm";
const TAG = /[^A-Za-z0-9_.\- ]/g;
const tag = (raw: string | null) =>
  (raw ?? "").replace(TAG, "").trim().slice(0, 60);

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
}

/** Remember the invite code and any campaign tags (utm_source and friends) in the current address.
 *  Call once when the app starts. The first campaign seen is kept: later visits do not replace it. */
export function captureInvite(search = window.location.search): void {
  const params = new URLSearchParams(search);
  const code = clean(params.get("ref"));
  const utm: Utm = {};
  for (const [key, name] of [
    ["utm_source", "source"],
    ["utm_medium", "medium"],
    ["utm_campaign", "campaign"],
  ] as const) {
    const v = tag(params.get(key));
    if (v) utm[name] = v;
  }
  try {
    if (code) localStorage.setItem(KEY, code);
    if (Object.keys(utm).length && !localStorage.getItem(UTM_KEY))
      localStorage.setItem(UTM_KEY, JSON.stringify(utm));
  } catch {
    /* storage can be blocked: nothing is kept */
  }
}

/** The remembered campaign tags, or undefined. */
export function savedUtm(): Utm | undefined {
  try {
    const raw = localStorage.getItem(UTM_KEY);
    return raw ? (JSON.parse(raw) as Utm) : undefined;
  } catch {
    return undefined;
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
