import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";

import {
  ActivityIcon,
  BuildingIcon,
  ChevronIcon,
  ChartIcon,
  CloseIcon,
  CoinIcon,
  GaugeIcon,
  GiftIcon,
  LogoutIcon,
  MailIcon,
  MenuIcon,
  SearchIcon,
  SendIcon,
  TargetIcon,
  UsersIcon,
} from "../../app/icons";
import { LogoMark } from "../landing/Logo";
import { CommandPalette } from "./CommandPalette";
import { PrivateScreen } from "../../app/usePrivateScreen";
import { useStaff, useStaffLogout } from "./staff";
import { Avatar, Loading } from "./ui";

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
      { to: "/admin/startups", label: "Startups", icon: <BuildingIcon /> },
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
    `group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
      collapsed ? "lg:justify-center lg:px-0" : ""
    } ${
      isActive
        ? "bg-surface/10 font-medium text-surface"
        : "text-surface/70 hover:bg-surface/5 hover:text-surface"
    }`;

/** The back office: a sidebar like the customer app's, but its own place with its own sign-in. Anyone
 *  without a staff session is sent to the staff sign-in page. The server refuses them too; this is
 *  a courtesy and not the protection. */
export function AdminLayout() {
  const { data: staff, isPending } = useStaff();
  const logout = useStaffLogout();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [jump, setJump] = useState(false);
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setJump((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const places = useMemo(
    () =>
      GROUPS.flatMap((g) =>
        g.items.map((i) => ({ to: i.to, label: i.label, group: g.title })),
      ),
    [],
  );
  const here = useMemo(() => {
    const path = location.pathname.replace(/\/$/, "");
    const hit = [...places]
      .sort((a, b) => b.to.length - a.to.length)
      .find((p) => path === p.to || path.startsWith(`${p.to}/`));
    return hit ?? places[0];
  }, [location.pathname, places]);

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
    <div className="flex min-h-screen bg-ink">
      {open && (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-ink/60 backdrop-blur-sm lg:hidden"
        />
      )}
      <aside
        id="admin-sidebar"
        className={`${
          open ? "fixed inset-y-0 left-0 z-50 flex w-72 shadow-lift" : "hidden"
        } flex-col bg-ink px-4 py-5 text-surface transition-[width] duration-200 lg:sticky lg:top-0 lg:flex lg:h-screen lg:shrink-0 lg:shadow-none ${
          collapsed ? "lg:w-[84px] lg:px-3" : "lg:w-64"
        }`}
      >
        <div
          className={`flex items-center ${
            collapsed ? "lg:justify-center" : "justify-between"
          }`}
        >
          <Link
            to="/admin"
            title={collapsed ? "InterviewMeet back office" : undefined}
            className="flex items-center gap-2.5 px-1 text-lg font-semibold"
          >
            <LogoMark className="h-8 w-8" />
            <span className={collapsed ? "lg:sr-only" : ""}>InterviewMeet</span>
          </Link>
          {!collapsed && (
            <button
              type="button"
              aria-label="Collapse sidebar"
              aria-expanded={true}
              aria-controls="admin-nav"
              onClick={toggleCollapsed}
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-surface/70 hover:bg-surface/10 hover:text-surface lg:flex"
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
          className={`mt-4 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-accent-soft/70 ${
            collapsed ? "lg:sr-only" : ""
          }`}
        >
          Back office
        </p>
        <nav
          id="admin-nav"
          aria-label="Admin sections"
          className="mt-1 flex-1 overflow-y-auto"
        >
          {GROUPS.map((g) => (
            <div key={g.title} className="mt-5">
              <p
                className={`px-3 pb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-surface/40 ${
                  collapsed ? "lg:sr-only" : ""
                }`}
              >
                {g.title}
              </p>
              <ul className="space-y-0.5">
                {g.items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={i.end}
                      className={linkClass(collapsed)}
                      title={collapsed ? i.label : undefined}
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span
                              aria-hidden="true"
                              className="absolute left-0 top-2.5 h-6 w-1 rounded-r-full bg-accent"
                            />
                          )}
                          {i.icon}
                          <span className={collapsed ? "lg:sr-only" : ""}>
                            {i.label}
                          </span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="mt-4 rounded-2xl bg-surface/5 p-2">
          <div
            className={`flex items-center gap-3 px-2 py-1.5 ${
              collapsed ? "lg:justify-center lg:px-0" : ""
            }`}
          >
            <Avatar name={staff.full_name || staff.email} size={32} />
            <p
              className={`min-w-0 truncate text-xs text-surface/80 ${
                collapsed ? "lg:sr-only" : ""
              }`}
              title="Signed in as"
            >
              {staff.full_name || staff.email}
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            title={collapsed ? "Sign out" : undefined}
            className={`mt-1 flex min-h-[40px] w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-surface/70 hover:bg-surface/10 hover:text-surface ${
              collapsed ? "lg:justify-center lg:px-0" : ""
            }`}
          >
            <LogoutIcon />
            <span className={collapsed ? "lg:sr-only" : ""}>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-canvas lg:rounded-l-3xl">
        <header className="sticky top-0 z-30 flex items-center gap-3 bg-canvas/90 px-4 py-2.5 backdrop-blur sm:px-6 lg:rounded-tl-3xl lg:px-8">
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="admin-sidebar"
            onClick={() => setOpen((v) => !v)}
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl hover:bg-accent-soft lg:hidden"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
          <p className="min-w-0 flex-1 truncate text-sm text-muted">
            <span className="hidden sm:inline">Back office · </span>
            <span className="font-medium text-ink">{here.label}</span>
          </p>
          <button
            type="button"
            aria-label="Jump to"
            onClick={() => setJump(true)}
            className="flex min-h-[44px] items-center gap-2 rounded-xl bg-surface px-3 text-sm text-muted shadow-card hover:text-ink sm:min-w-[220px]"
          >
            <SearchIcon className="h-4 w-4" />
            <span className="hidden flex-1 text-left sm:block">Jump to…</span>
            <kbd className="hidden rounded-md bg-canvas px-1.5 py-0.5 text-[11px] sm:block">
              Ctrl K
            </kbd>
          </button>
        </header>
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-6xl space-y-6 p-4 pb-12 sm:p-6 lg:p-8">
            <PrivateScreen>
              <Outlet />
            </PrivateScreen>
          </div>
        </main>
      </div>
      {jump && (
        <CommandPalette places={places} onClose={() => setJump(false)} />
      )}
    </div>
  );
}
