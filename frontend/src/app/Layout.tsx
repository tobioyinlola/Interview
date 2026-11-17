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
  NoteIcon,
  ChartIcon,
  ShieldIcon,
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

const link = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
    isActive
      ? "bg-surface font-medium text-ink shadow-card"
      : "text-surface/75 hover:bg-surface/10 hover:text-surface"
  }`;

function Group({ title, items }: { title: string; items: Item[] }) {
  return (
    <div className="mt-6">
      <p className="px-3 pb-2 text-xs text-surface/50">{title}</p>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.to}>
            <NavLink to={i.to} end={i.end} className={link}>
              {i.icon}
              {i.label}
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
  useEffect(() => setOpen(false), [location.pathname]); // close the drawer after navigating

  const menu = [
    item("/dashboard", "Overview", <HomeIcon />, true),
    item("/notes", "CV", <NoteIcon />),
    item("/companies", "Companies", <BuildingIcon />),
    item("/session/new", "Practice", <MicIcon />),
  ];
  const account = [
    item("/sessions", "Sessions", <ListIcon />),
    ...(me?.is_admin ? [item("/admin/usage", "Usage", <ChartIcon />)] : []),
    item("/settings", "Settings", <GearIcon />),
  ];
  const support = [
    item("/privacy", "Privacy", <ShieldIcon />),
    item("/terms", "Terms", <FileIcon />),
  ];

  return (
    <div className="min-h-screen bg-ink lg:flex">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between bg-ink px-4 py-3 text-surface lg:hidden">
        <Link to="/dashboard" className="flex items-center gap-2 font-semibold">
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
        } flex-col bg-ink px-4 py-5 text-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0`}
      >
        <Link
          to="/dashboard"
          className="hidden items-center gap-2 px-3 text-lg font-semibold lg:flex"
        >
          <LogoMark className="h-8 w-8" /> InterviewMeet
        </Link>
        <nav aria-label="Main" className="lg:mt-4 lg:flex-1 lg:overflow-y-auto">
          <Group title="Menu" items={menu} />
          <Group title="Account" items={account} />
          <Group title="Support" items={support} />
        </nav>
        <div className="mt-6 border-t border-surface/15 pt-4">
          <p className="truncate px-3 text-xs text-surface/60">{me?.email}</p>
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-surface/75 hover:bg-surface/10 hover:text-surface"
            onClick={() =>
              logout.mutate(undefined, { onSuccess: () => navigate("/login") })
            }
          >
            <LogoutIcon /> Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 bg-canvas lg:min-h-screen lg:rounded-l-[2rem]">
        <Outlet />
      </div>
    </div>
  );
}
