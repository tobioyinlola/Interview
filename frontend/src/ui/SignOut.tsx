import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useLogout } from "../api/hooks";

/** Signing out asks first, so a stray tap on the menu never ends the session. `ask()` opens the
 *  question; render `dialog` once somewhere in the page. */
export function useSignOut() {
  const logout = useLogout();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancel.current?.focus(); // the safe choice has the focus
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab") {
        // keep the focus between the two buttons while the question is open
        e.preventDefault();
        (document.activeElement === cancel.current
          ? confirm
          : cancel
        ).current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const dialog = open ? (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="signout-h"
        aria-describedby="signout-d"
        className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-5 shadow-lift"
      >
        <h2 id="signout-h" className="text-lg font-semibold">
          Sign out?
        </h2>
        <p id="signout-d" className="text-sm text-muted">
          You will need to sign in again to use InterviewMeet on this device.
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            ref={cancel}
            type="button"
            className="btn-secondary"
            onClick={() => setOpen(false)}
          >
            Stay signed in
          </button>
          <button
            ref={confirm}
            type="button"
            className="btn-danger-outline"
            disabled={logout.isPending}
            onClick={() =>
              logout.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false);
                  navigate("/login");
                },
              })
            }
          >
            {logout.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask: () => setOpen(true), dialog };
}
