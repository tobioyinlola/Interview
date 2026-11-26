/** The two random ids the usage statistics use. Neither is a fingerprint or anything about the person:
 *  one stays on the device (so a returning device is one device), the other is one visit, which ends
 *  after half an hour of nothing. Kept in local storage when the browser or app allows it. */

const DEVICE_KEY = "im-analytics-device";
const SESSION_KEY = "im-analytics-session";
export const SESSION_IDLE_MS = 30 * 60 * 1000;

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage can be unavailable (private windows): ids then last until the page closes
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not remembered */
  }
};

let device: string | undefined;
export function deviceId(): string {
  if (device) return device;
  const saved = read(DEVICE_KEY);
  device = saved && /^[0-9a-f-]{8,36}$/.test(saved) ? saved : uuid();
  if (device !== saved) write(DEVICE_KEY, device);
  return device;
}

interface Visit {
  id: string;
  last: number;
}
let visit: Visit | undefined;

/** The current visit, started anew after half an hour without any activity. `fresh` is true when this
 *  call began a new one. */
export function touchVisit(now = Date.now()): { id: string; fresh: boolean } {
  if (!visit) {
    try {
      const raw = read(SESSION_KEY);
      const parsed = raw ? (JSON.parse(raw) as Visit) : undefined;
      if (parsed && /^[0-9a-f-]{8,36}$/.test(parsed.id)) visit = parsed;
    } catch {
      visit = undefined;
    }
  }
  let fresh = false;
  if (!visit || now - visit.last > SESSION_IDLE_MS) {
    visit = { id: uuid(), last: now };
    fresh = true;
  }
  visit.last = now;
  write(SESSION_KEY, JSON.stringify(visit));
  return { id: visit.id, fresh };
}

/** For tests. */
export function resetIds(): void {
  device = undefined;
  visit = undefined;
}
