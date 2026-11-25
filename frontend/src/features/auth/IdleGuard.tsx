import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { apiFetch } from "../../api/client";

/** Signed-in people are signed out after this long without touching the app. */
export const IDLE_MS = 20 * 60_000;
const WARN_MS = 60_000; // told this long before it happens
const HEARTBEAT_MS = 4 * 60_000; // keeps the server's own idle clock fresh while someone is here
const KEY = "im-last-active";
const EVENTS = ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"];

const stored = (): number => {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0; // storage can be unavailable: this tab's own clock is used
  }
};

/** Signs the person out after 20 minutes of inactivity, on every app. Any touch, key or movement
 *  counts, in any tab. A minute before, a prompt lets them stay. A live interview never counts as
 *  idle (nobody touches the screen on a call), and keeps the session fresh while it runs. */
export function IdleGuard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const live = /^\/session\/(?!new)/.test(pathname);
  const last = useRef(Date.now());
  const signingOut = useRef(false);
  const [left, setLeft] = useState<number | null>(null);

  const touch = useCallback(() => {
    const now = Date.now();
    if (now - last.current < 1000) return; // not a write on every mouse move
    last.current = now;
    try {
      localStorage.setItem(KEY, String(now));
    } catch {
      /* not shared with other tabs */
    }
  }, []);

  const stay = useCallback(() => {
    last.current = 0; // let touch() record this one even if it is within a second of another
    touch();
    setLeft(null);
  }, [touch]);

  useEffect(() => {
    const signOut = async () => {
      if (signingOut.current) return; // the check runs every few seconds: sign out once
      signingOut.current = true;
      try {
        await apiFetch("/api/auth/logout", { method: "POST" });
      } catch {
        /* already signed out on the server, which is the point */
      }
      navigate("/login?idle=1", { replace: true }); // first, so the guard cannot send us elsewhere
      qc.clear();
      qc.setQueryData(["me"], null);
    };
    const check = () => {
      if (live) {
        touch();
        setLeft(null);
        return;
      }
      const idle = Date.now() - Math.max(last.current, stored());
      if (idle >= IDLE_MS) void signOut();
      else if (idle >= IDLE_MS - WARN_MS)
        setLeft(Math.max(1, Math.ceil((IDLE_MS - idle) / 1000)));
      else setLeft(null);
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    for (const e of EVENTS)
      window.addEventListener(e, touch, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const tick = setInterval(check, 5000);
    const beat = setInterval(() => {
      const idle = Date.now() - Math.max(last.current, stored());
      if (live || idle < HEARTBEAT_MS) void apiFetch("/api/me").catch(() => {});
    }, HEARTBEAT_MS);
    check(); // coming back after a long time away
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, touch);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      clearInterval(tick);
      clearInterval(beat);
    };
  }, [live, navigate, qc, touch]);

  if (left === null) return null;
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Signing out soon"
      className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-ink p-4 text-surface shadow-lift sm:bottom-6"
    >
      <p className="text-sm">
        You have been away a while. You will be signed out in{" "}
        <span className="font-semibold tabular-nums">{left}</span> seconds.
      </p>
      <button
        type="button"
        onClick={stay}
        className="btn shrink-0 bg-surface text-ink hover:bg-canvas"
      >
        Stay signed in
      </button>
    </div>
  );
}
