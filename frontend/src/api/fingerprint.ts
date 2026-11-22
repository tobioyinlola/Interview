/** A coarse description of this device, sent with requests so that inviting yourself from a second
 *  email does not earn a reward. It is a hash of a few plain facts (screen size, time zone, language,
 *  processor count, platform), not the browser's name or anything that identifies a person, and the
 *  server keeps only a keyed hash of it. It is the same in a private window, which is the point. */
let current: string | undefined;

/** The facts, in a fixed order. Screen sides are sorted so rotating a tablet changes nothing. */
export function fingerprintInputs(): string {
  const s = typeof screen === "undefined" ? undefined : screen;
  const sides = s ? [s.width, s.height].sort((a, b) => b - a) : [];
  let zone = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    /* some browsers hide it */
  }
  return [
    sides.join("x"),
    s?.colorDepth ?? "",
    zone,
    (navigator.language ?? "").toLowerCase(),
    navigator.hardwareConcurrency ?? "",
    navigator.platform ?? "",
  ].join("|");
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Work it out once, when the app starts. If the browser cannot, requests simply go without it. */
export async function initFingerprint(): Promise<void> {
  try {
    current = await sha256Hex(fingerprintInputs());
  } catch {
    current = undefined;
  }
}

export const fingerprint = () => current;
