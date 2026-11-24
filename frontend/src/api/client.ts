import { fingerprint } from "./fingerprint";
import { clearCache } from "./persist";
import {
  APP_SHELL,
  authInit,
  setSessionToken,
  takeSessionToken,
} from "./session";

/** Typed REST client. Cookie auth, CSRF header on mutations, one error shape. */
// An empty value means "the API is on this same origin" (the web server forwards /api to it); only
// an unset value falls back to the local development address.
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

/** The WebSocket origin for an API base. An empty base is this page's own origin. */
export function socketBase(
  base: string,
  loc: Pick<Location, "protocol" | "host"> = window.location,
): string {
  if (base === "")
    return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}`;
  return base.replace(/^http/i, "ws");
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  // JSON unless the caller sends something else (a file upload sets its own content type)
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  if (method !== "GET") headers.set("x-requested-with", "meet-practice"); // CSRF header
  const print = fingerprint();
  if (print) headers.set("x-device-fp", print); // see fingerprint.ts: stops self-invites
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, authInit({ ...init, headers }));
  } catch {
    // no connection (or the server is unreachable): say so plainly instead of "Failed to fetch"
    throw new ApiError(
      0,
      "network",
      "You're offline. Check your connection and try again.",
      "",
    );
  }
  takeSessionToken(res);
  if (path === "/api/auth/logout") {
    setSessionToken(null);
    clearCache(); // nothing of this person stays on the device
  }
  if (APP_SHELL && res.status === 401 && path !== "/api/auth/login")
    setSessionToken(null); // the saved token is no longer good
  if (!res.ok) {
    let code = "unknown";
    let message = `Request failed (${res.status})`;
    let requestId = res.headers.get("x-request-id") ?? "";
    try {
      const body = await res.json();
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      requestId = body.error?.request_id ?? requestId;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message, requestId);
  }
  return (await res.json()) as T;
}
