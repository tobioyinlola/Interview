import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";

import {
  ActivityIcon,
  BuildingIcon,
  ChevronIcon,
  CompassIcon,
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
      { to: "/admin/engagement", label: "Engagement", icon: <CompassIcon /> },
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
    `group relative flex min-h-[44px] items-center gap-3 rounded-2xl px-3 py-2 text-sm transition-colors ${
      collapsed ? "lg:justify-center lg:px-0" : ""
    } ${
      isActive
        ? "bg-ink font-medium text-surface shadow-card"
        : "text-muted hover:bg-panel hover:text-ink"
    }`;

/** The staff member's local time, to the minute. */
function useClock(): string {
  const read = () =>
    new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const [t, setT] = useState(read);
  useEffect(() => {
    const id = window.setInterval(() => setT(read()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return t;
}

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
  const clock = useClock();

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
    <div className="adm flex min-h-screen gap-3 bg-shell p-2 lg:p-3">
      {open && (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm lg:hidden"
        />
      )}
      <aside
        id="admin-sidebar"
        className={`${
          open ? "fixed inset-y-2 left-2 z-50 flex w-72 shadow-lift" : "hidden"
        } flex-col rounded-3xl bg-surface p-3 transition-[width] duration-200 lg:sticky lg:top-3 lg:flex lg:h-[calc(100vh-1.5rem)] lg:shrink-0 lg:shadow-card ${
          collapsed ? "lg:w-[84px]" : "lg:w-64"
        }`}
      >
        <div
          className={`flex items-center px-1 pt-1 ${
            collapsed ? "lg:justify-center" : "justify-between"
          }`}
        >
          <Link
            to="/admin"
            title={collapsed ? "InterviewMeet back office" : undefined}
            className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"
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
              className="hidden h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink lg:flex"
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
            className="mx-auto mt-3 hidden h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink lg:flex"
          >
            <ChevronIcon className="h-5 w-5" direction="right" />
          </button>
        )}
        <p
          className={`mt-1 px-1 text-xs text-muted ${
            collapsed ? "lg:sr-only" : ""
          }`}
        >
          Back office
        </p>
        <nav
          id="admin-nav"
          aria-label="Admin sections"
          className="mt-3 flex-1 overflow-y-auto"
        >
          {GROUPS.map((g, gi) => (
            <div key={g.title} className={gi === 0 ? "" : "mt-4"}>
              <p
                className={`px-3 pb-1.5 text-xs font-medium text-muted/70 ${
                  collapsed ? "lg:sr-only" : ""
                }`}
              >
                {g.title}
              </p>
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
        <button
          type="button"
          onClick={signOut}
          title={collapsed ? "Sign out" : undefined}
          className={`mt-3 flex min-h-[44px] w-full items-center gap-3 rounded-2xl bg-panel px-3 py-2 text-sm text-muted transition-colors hover:text-ink ${
            collapsed ? "lg:justify-center lg:px-0" : ""
          }`}
        >
          <LogoutIcon />
          <span className={collapsed ? "lg:sr-only" : ""}>Sign out</span>
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="sticky top-2 z-30 flex items-center gap-2 rounded-3xl bg-surface/95 px-2.5 py-2 shadow-card backdrop-blur sm:gap-3 sm:px-3 lg:top-3">
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="admin-sidebar"
            onClick={() => setOpen((v) => !v)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel hover:bg-accent-soft lg:hidden"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
          <button
            type="button"
            aria-label="Jump to"
            onClick={() => setJump(true)}
            className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 rounded-full bg-panel px-4 text-sm text-muted transition-colors hover:text-ink sm:max-w-md sm:flex-none sm:basis-[26rem]"
          >
            <SearchIcon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              Search pages, people…
            </span>
            <kbd className="hidden rounded-md bg-surface px-1.5 py-0.5 text-[11px] shadow-card sm:block">
              Ctrl K
            </kbd>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4">
            <p className="hidden text-right leading-tight sm:block">
              <span className="block text-[11px] text-muted">Local time</span>
              <span className="text-sm font-semibold tabular-nums">
                {clock}
              </span>
            </p>
            <span className="flex items-center gap-2.5 rounded-full bg-panel py-1 pl-1 pr-3">
              <Avatar name={staff.full_name || staff.email} size={36} />
              <span className="hidden min-w-0 leading-tight md:block">
                <span className="block max-w-[11rem] truncate text-sm font-semibold">
                  {staff.full_name || staff.email}
                </span>
                <span className="block text-[11px] text-muted">
                  Back-office staff
                </span>
              </span>
            </span>
          </div>
        </header>
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1400px] space-y-6 px-1 pb-10 pt-3 sm:px-3 lg:px-4">
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
