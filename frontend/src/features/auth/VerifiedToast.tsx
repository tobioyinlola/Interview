import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "im-verified";
const EVENT = "im-verified";

const flagged = (): boolean => {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

/** Remember that this person has just been verified and signed in, so the next screen, wherever the
 *  app sends them (the dashboard or onboarding), can say so once. */
export function markVerified(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* the message is a courtesy */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** A short "your email is verified" notice at the top of the screen. */
export function VerifiedToast() {
  const [on, setOn] = useState(flagged);
  useEffect(() => {
    const show = () => setOn(flagged());
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => dismiss(), 7000);
    return () => clearTimeout(t);
  }, [on]);
  const dismiss = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
    setOn(false);
  };
  if (!on) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-surface shadow-lift"
    >
      <CircleCheck
        className="h-6 w-6 shrink-0 text-emerald-300"
        aria-hidden="true"
      />
      <span className="flex-1 text-sm">
        <strong className="block font-semibold">Your email is verified</strong>
        You&apos;re signed in. Welcome to InterviewMeet.
      </span>
      <button
        type="button"
        onClick={dismiss}
        className="min-h-[44px] px-2 text-sm font-medium text-surface/80"
      >
        OK
      </button>
    </div>
  );
}
