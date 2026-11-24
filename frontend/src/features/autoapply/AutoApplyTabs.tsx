import { NavLink } from "react-router-dom";

import { useMe } from "../../api/hooks";

/** Auto-Apply has two ways of getting you in front of people: job listings, and startups. One
 * place, one pause button, one set of your details. Hidden until startup outreach is switched on. */
export function AutoApplyTabs({ waiting = 0 }: { waiting?: number }) {
  const { data: me } = useMe();
  if (!me?.startup_outreach) return null;
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm transition-all sm:flex-none sm:px-6 ${
      isActive
        ? "bg-surface font-medium text-ink shadow-card"
        : "text-muted hover:text-ink"
    }`;
  return (
    <nav
      aria-label="Auto-Apply sections"
      className="flex w-full rounded-full bg-canvas p-1 sm:inline-flex sm:w-auto"
    >
      <NavLink to="/auto-apply" end className={link}>
        Jobs
      </NavLink>
      <NavLink to="/auto-apply/startups" className={link}>
        Startups
        {waiting > 0 && (
          <span className="rounded-full bg-accent px-2 text-xs font-medium text-surface">
            {waiting}
          </span>
        )}
      </NavLink>
    </nav>
  );
}
