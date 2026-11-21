import { NavLink, Navigate, Outlet } from "react-router-dom";

import { useMe } from "../../api/hooks";

const TABS = [
  { to: "/admin", label: "Overview", end: true },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/activity", label: "Activity log" },
  { to: "/admin/referrals", label: "Referrals" },
  { to: "/admin/marketing", label: "Marketing" },
  { to: "/admin/quality", label: "Quality" },
  { to: "/admin/emails", label: "Emails" },
  { to: "/admin/usage", label: "Cost" },
];

/** The frame for the admin console: a heading and a row of tabs. Only an admin gets here; the server
 *  also refuses everyone else, so this is a courtesy and not the protection. */
export function AdminLayout() {
  const { data: me } = useMe();
  if (me?.is_admin === false) return <Navigate to="/dashboard" replace />;
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-dark">
          Admin
        </p>
        <nav aria-label="Admin sections" className="mt-2 -mx-1 overflow-x-auto">
          <ul className="flex min-w-max gap-1 px-1">
            {TABS.map((t) => (
              <li key={t.to}>
                <NavLink
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    `inline-flex min-h-[40px] items-center rounded-full px-4 text-sm transition-colors ${
                      isActive
                        ? "bg-ink font-medium text-surface"
                        : "text-muted hover:bg-accent-soft hover:text-ink"
                    }`
                  }
                >
                  {t.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <Outlet />
    </main>
  );
}
