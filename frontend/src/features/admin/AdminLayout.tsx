import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";

import {
  ActivityIcon,
  ChevronIcon,
  ChartIcon,
  CloseIcon,
  CoinIcon,
  GaugeIcon,
  GiftIcon,
  LogoutIcon,
  MailIcon,
  MenuIcon,
  SendIcon,
  TargetIcon,
  UsersIcon,
} from "../../app/icons";
import { LogoMark } from "../landing/Logo";
import { useStaff, useStaffLogout } from "./staff";
import { Loading } from "./ui";

type Item = { to: string; label: string; icon: React.ReactNode; end?: boolean };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Product",
    items: [
      { to: "/admin", label: "Overview", icon: <ChartIcon />, end: true },
      { to: "/admin/users", label: "Users", icon: <UsersIcon /> },
      { to: "/admin/activity", label: "Activity log", icon: <ActivityIcon /> },
    ],
  },
  {
    title: "Growth",
    items: [
      { to: "/admin/referrals", label: "Referrals", icon: <GiftIcon /> },
      { to: "/admin/marketing", label: "Marketing", icon: <TargetIcon /> },
      { to: "/admin/emails", label: "Emails", icon: <MailIcon /> },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/admin/quality", label: "Quality", icon: <GaugeIcon /> },
      { to: "/admin/auto-apply", label: "Auto-Apply", icon: <SendIcon /> },
      { to: "/admin/usage", label: "Cost", icon: <CoinIcon /> },
    ],
  },
];

const COLLAPSE_KEY = "meet-backoffice-sidebar-collapsed";
const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false; // storage can be unavailable: the choice just is not remembered
  }
};

const linkClass =
  (collapsed: boolean) =>
  ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
      collapsed ? "lg:justify-center lg:px-0" : ""
    } ${
      isActive
        ? "bg-surface font-medium text-ink shadow-card"
        : "text-surface/75 hover:bg-surface/10 hover:text-surface"
    }`;

/** The back office: a sidebar like the customer app's, but its own place with its own sign-in. Anyone
 *  without a staff session is sent to the staff sign-in page. The server refuses them too; this is
 *  a courtesy and not the protection. */
export function AdminLayout() {
  const { data: staff, isPending } = useStaff();
  const logout = useStaffLogout();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* not remembered */
      }
      return !c;
    });
  useEffect(() => setOpen(false), [location.pathname]); // close the drawer after navigating

  if (isPending)
    return (
      <div className="p-8">
        <Loading what="the back office" />
      </div>
    );
  if (!staff) return <Navigate to="/admin/login" replace />;

  const signOut = () =>
    logout.mutate(undefined, {
      onSuccess: () => window.location.assign("/admin/login"),
    });

  return (
    <div className="flex min-h-screen flex-col bg-ink lg:flex-row">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between bg-ink px-4 py-3 text-surface lg:hidden">
        <Link to="/admin" className="flex items-center gap-2 font-semibold">
          <LogoMark className="h-7 w-7" /> Back office
        </Link>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="admin-sidebar"
          onClick={() => setOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface/10"
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      <aside
        id="admin-sidebar"
        className={`${
          open ? "flex" : "hidden"
        } flex-col bg-ink px-4 py-5 text-surface transition-[width] duration-200 lg:sticky lg:top-0 lg:flex lg:h-screen lg:shrink-0 ${
          collapsed ? "lg:w-[84px] lg:px-3" : "lg:w-64"
        }`}
      >
        <div
          className={`hidden items-center lg:flex ${
            collapsed ? "justify-center" : "justify-between"
          }`}
        >
          <Link
            to="/admin"
            title={collapsed ? "InterviewMeet back office" : undefined}
            className="flex items-center gap-2 px-1 text-lg font-semibold"
          >
            <LogoMark className="h-8 w-8" />
            <span className={collapsed ? "sr-only" : ""}>InterviewMeet</span>
          </Link>
          {!collapsed && (
            <button
              type="button"
              aria-label="Collapse sidebar"
              aria-expanded={true}
              aria-controls="admin-nav"
              onClick={toggleCollapsed}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-surface/70 hover:bg-surface/10 hover:text-surface"
            >
              <ChevronIcon className="h-5 w-5" direction="left" />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            type="button"
            aria-label="Expand sidebar"
            aria-expanded={false}
            aria-controls="admin-nav"
            onClick={toggleCollapsed}
            className="mx-auto mt-3 hidden h-9 w-9 items-center justify-center rounded-lg text-surface/70 hover:bg-surface/10 hover:text-surface lg:flex"
          >
            <ChevronIcon className="h-5 w-5" direction="right" />
          </button>
        )}
        <p
          className={`mt-3 hidden px-3 text-xs uppercase tracking-widest text-accent-soft/80 lg:block ${
            collapsed ? "lg:sr-only" : ""
          }`}
        >
          Back office
        </p>
        <nav
          id="admin-nav"
          aria-label="Admin sections"
          className="lg:mt-1 lg:flex-1 lg:overflow-y-auto"
        >
          {GROUPS.map((g) => (
            <div key={g.title} className="mt-6">
              <p
                className={`px-3 pb-2 text-xs text-surface/50 ${
                  collapsed ? "lg:sr-only" : ""
                }`}
              >
                {g.title}
              </p>
              {collapsed && (
                <hr className="mx-3 mb-2 hidden border-surface/15 lg:block" />
              )}
              <ul className="space-y-1">
                {g.items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={i.end}
                      className={linkClass(collapsed)}
                      title={collapsed ? i.label : undefined}
                    >
                      {i.icon}
                      <span className={collapsed ? "lg:sr-only" : ""}>
                        {i.label}
                      </span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="mt-6 border-t border-surface/15 pt-4">
          <p
            className={`truncate px-3 text-xs text-surface/60 ${
              collapsed ? "lg:sr-only" : ""
            }`}
            title="Signed in as"
          >
            {staff.full_name || staff.email}
          </p>
          <button
            type="button"
            onClick={signOut}
            title={collapsed ? "Sign out" : undefined}
            className={`mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-surface/75 hover:bg-surface/10 hover:text-surface ${
              collapsed ? "lg:justify-center lg:px-0" : ""
            }`}
          >
            <LogoutIcon />
            <span className={collapsed ? "lg:sr-only" : ""}>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 bg-canvas lg:rounded-l-3xl">
        <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
