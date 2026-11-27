import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useMe } from "../../api/hooks";
import { useHuntTemplate } from "./api";

const KEY = "im-emails-prompt-later";
const LATER_MS = 3 * 24 * 60 * 60 * 1000; // asked again after three days

const snoozed = (): boolean => {
  try {
    const t = Number(localStorage.getItem(KEY));
    return Boolean(t) && Date.now() - t < LATER_MS;
  } catch {
    return false;
  }
};

/** Asks anyone who has startup outreach, and has not set up their emails yet, to write them, choose
 *  when they go, and turn them on. It never turns anything on by itself: sending from someone's own
 *  address is their decision. "Later" hides it for three days. */
export function EmailsPrompt() {
  const { data: me } = useMe();
  const open = me?.startup_outreach === true && me.outreach_access === "active";
  const t = useHuntTemplate(open);
  const here = useLocation().pathname.startsWith("/startups");
  const [hidden, setHidden] = useState(snoozed);

  if (!open || here || hidden || !t.data || t.data.use_template) return null;
  const later = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* a courtesy */
    }
    setHidden(true);
  };
  return (
    <div
      role="dialog"
      aria-label="Set up your cold emails"
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 mx-auto max-w-md space-y-3 rounded-2xl bg-surface p-4 shadow-lift ring-1 ring-line"
    >
      <p className="font-semibold">Set up your cold emails</p>
      <p className="text-sm text-muted">
        Write your first email and follow-up once, add your portfolio link and
        details, choose when the first one goes and how many days before the
        follow-up, then turn it on. Nothing is sent until you do.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link to="/startups?tab=emails" className="btn-primary" onClick={later}>
          Set it up
        </Link>
        <button type="button" className="btn-secondary" onClick={later}>
          Later
        </button>
      </div>
    </div>
  );
}
