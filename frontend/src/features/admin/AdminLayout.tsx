import { NavLink, Navigate, Outlet } from "react-router-dom";

import { LogoMark } from "../landing/Logo";
import { Loading } from "./ui";
import { useStaff, useStaffLogout } from "./staff";

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

/** The back office: its own header, its own sign-in, no customer navigation. Anyone without a
 *  staff session is sent to the staff sign-in page. The server refuses them too; this is a
 *  courtesy and not the protection. */
export function AdminLayout() {
  const { data: staff, isPending } = useStaff();
  const logout = useStaffLogout();
  if (isPending)
    return (
      <div className="p-8">
        <Loading what="the back office" />
      </div>
    );
  if (!staff) return <Navigate to="/admin/login" replace />;
  return (
    <div className="min-h-screen bg-canvas text-ink [min-height:100dvh]">
      <header className="bg-ink text-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <LogoMark />
            <p className="font-semibold leading-tight">
              InterviewMeet{" "}
              <span className="font-normal text-surface/70">Back office</span>
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-surface/80" title="Signed in as">
              {staff.full_name || staff.email}
            </span>
            <button
              type="button"
              className="rounded-full border border-surface/30 px-3 py-1.5 hover:bg-surface/10"
              onClick={() =>
                logout.mutate(undefined, {
                  onSuccess: () => window.location.assign("/admin/login"),
                })
              }
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
        <nav aria-label="Admin sections" className="-mx-1 overflow-x-auto">
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
        <Outlet />
      </main>
    </div>
  );
}
