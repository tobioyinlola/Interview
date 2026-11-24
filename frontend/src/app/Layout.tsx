import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { useLogout, useMe } from "../api/hooks";
import { LogoMark } from "../features/landing/Logo";
import { GlobalSearch } from "../features/search/GlobalSearch";
import { ProfileMenu } from "./ProfileMenu";
import { UpdateBanner } from "./UpdateBanner";
import { TourProvider } from "../features/tour/TourProvider";
import {
  BuildingIcon,
  CloseIcon,
  FileIcon,
  GearIcon,
  HomeIcon,
  ListIcon,
  LogoutIcon,
  MenuIcon,
  MicIcon,
  ShieldIcon,
  ChevronIcon,
  GiftIcon,
  HelpIcon,
  SendIcon,
} from "./icons";

type Item = { to: string; label: string; icon: React.ReactNode; end?: boolean };

const item = (
  to: string,
  label: string,
  icon: React.ReactNode,
  end = false,
): Item => ({
  to,
  label,
  icon,
  end,
});

const COLLAPSE_KEY = "meet-practice-sidebar-collapsed";
const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false; // storage can be unavailable: the choice just is not remembered
  }
};

/** The collapsed sidebar (large screens only) shows icons; the names stay available to screen
 *  readers and as tooltips. On a phone the menu is a drawer and is never collapsed. */
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

function Group({
  title,
  items,
  collapsed,
}: {
  title: string;
  items: Item[];
  collapsed: boolean;
}) {
  return (
    <div className="mt-6">
      <p
        className={`px-3 pb-2 text-xs text-surface/50 ${collapsed ? "lg:sr-only" : ""}`}
      >
        {title}
      </p>
      {collapsed && <div className="mb-2 hidden lg:block" />}
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.to}>
            <NavLink
              to={i.to}
              end={i.end}
              className={linkClass(collapsed)}
              data-tour={`nav${i.to.replace(/\W+/g, "-")}`}
              title={collapsed ? i.label : undefined}
            >
              {i.icon}
              <span className={collapsed ? "lg:sr-only" : ""}>{i.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Layout() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
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

  const menu = [
    item("/dashboard", "Overview", <HomeIcon />, true),
    item("/companies", "Companies", <BuildingIcon />),
    item("/session/new", "Interview", <MicIcon />),
    ...(me?.autoapply ? [item("/auto-apply", "Auto-Apply", <SendIcon />)] : []),
    ...(me?.startup_outreach
      ? [item("/startups", "Startups", <BuildingIcon />)]
      : []),
    item("/referrals", "Invite friends", <GiftIcon />),
  ];
  const account = [
    item("/sessions", "Sessions", <ListIcon />),
    item("/settings", "Settings", <GearIcon />),
  ];
  const support = [
    item("/help", "Help", <HelpIcon />),
    item("/privacy", "Privacy", <ShieldIcon />),
    item("/terms", "Terms", <FileIcon />),
  ];

  return (
    <TourProvider>
      <div className="flex min-h-screen flex-col bg-ink lg:flex-row">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between bg-ink px-4 py-3 text-surface lg:hidden">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 font-semibold"
          >
            <LogoMark className="h-7 w-7" /> InterviewMeet
          </Link>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="sidebar"
            onClick={() => setOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-surface/10"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>

        <aside
          id="sidebar"
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
              to="/dashboard"
              title={collapsed ? "InterviewMeet" : undefined}
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
                aria-controls="sidebar-nav"
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
              aria-controls="sidebar-nav"
              onClick={toggleCollapsed}
              className="mx-auto mt-3 hidden h-9 w-9 items-center justify-center rounded-lg text-surface/70 hover:bg-surface/10 hover:text-surface lg:flex"
            >
              <ChevronIcon className="h-5 w-5" direction="right" />
            </button>
          )}
          <nav
            id="sidebar-nav"
            aria-label="Main"
            className="lg:mt-2 lg:flex-1 lg:overflow-y-auto"
          >
            <Group title="Menu" items={menu} collapsed={collapsed} />
            <Group title="Account" items={account} collapsed={collapsed} />
            <Group title="Support" items={support} collapsed={collapsed} />
          </nav>
          <div className="mt-6 pt-4">
            <p
              className={`truncate px-3 text-xs text-surface/60 ${collapsed ? "lg:sr-only" : ""}`}
            >
              {me?.email}
            </p>
            <button
              type="button"
              title={collapsed ? "Sign out" : undefined}
              className={`mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-surface/75 hover:bg-surface/10 hover:text-surface ${
                collapsed ? "lg:justify-center lg:px-0" : ""
              }`}
              onClick={() =>
                logout.mutate(undefined, {
                  onSuccess: () => navigate("/login"),
                })
              }
            >
              <LogoutIcon />
              <span className={collapsed ? "lg:sr-only" : ""}>Sign out</span>
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 bg-canvas lg:min-h-screen lg:rounded-l-[2rem]">
          <UpdateBanner />
          {/* The top bar on every page: search on the left, the person's account on the right. */}
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-canvas/85 px-4 py-3 backdrop-blur sm:px-5 lg:rounded-tl-[2rem] lg:px-5">
            <GlobalSearch />
            <ProfileMenu />
          </header>
          <Outlet />
        </div>
      </div>
    </TourProvider>
  );
}
