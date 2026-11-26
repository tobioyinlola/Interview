import { track } from "./client";
import { cleanRoute } from "./engagement";

/** What is picked up without each screen having to ask: marked controls, links in the menus, crashes,
 *  the connection coming and going, and how long the first screen took. None of it reads text. */

const CODE = /^[a-z0-9][a-z0-9_.:-]{0,39}$/;

/** A value made safe to send as a code: lower case, plain characters only, short. */
export function code(value: unknown, fallback = "unknown"): string {
  const s = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 40);
  return CODE.test(s) ? s : fallback;
}

function onClick(e: MouseEvent): void {
  const el = e.target instanceof Element ? e.target : null;
  if (!el) return;
  const marked = el.closest<HTMLElement>("[data-ev]");
  if (marked) {
    const ev = marked.dataset.ev ?? "";
    if (CODE.test(ev)) track("interaction", { ev });
    return;
  }
  // every link in a menu says where it goes, by route only
  const link = el.closest<HTMLAnchorElement>("nav a[href^='/']");
  if (link) {
    const path = cleanRoute(link.getAttribute("href") ?? "/");
    track("interaction", {
      ev: code(`nav:${path.slice(1).replace(/\//g, ".") || "home"}`),
    });
  }
}

export function startCapture(): () => void {
  let errors = 0;
  const reset = setInterval(() => (errors = 0), 60_000); // a crash loop must not flood
  const fail = (source: string, who: unknown) => {
    if (errors++ >= 5) return;
    const name =
      who instanceof Error
        ? who.name
        : typeof who === "object" && who
          ? (who as { name?: string }).name
          : "";
    track("ui_error", { kind: code(name, "error"), source });
  };
  const onError = (e: ErrorEvent) => fail("window", e.error);
  const onRejection = (e: PromiseRejectionEvent) => fail("promise", e.reason);
  const online = () => track("connectivity", { state: "online" });
  const offline = () => track("connectivity", { state: "offline" });
  document.addEventListener("click", onClick, true);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  const loaded = () => {
    const ms = Math.round(performance.now());
    if (ms > 0 && ms < 600_000) track("app_loaded", { ms });
  };
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  if (document.readyState === "complete") loadTimer = setTimeout(loaded, 0);
  else
    window.addEventListener("load", () => (loadTimer = setTimeout(loaded, 0)), {
      once: true,
    });
  return () => {
    clearInterval(reset);
    if (loadTimer) clearTimeout(loadTimer);
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
}
