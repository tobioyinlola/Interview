import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useLogout, useMe } from "../api/hooks";
import { firstName } from "../features/account/names";
import { useTour } from "../features/tour/TourProvider";
import {
  FileIcon,
  GearIcon,
  HelpIcon,
  HomeIcon,
  LogoutIcon,
  ShieldIcon,
  CompassIcon,
} from "./icons";

/** "JR" for Jordan Reyes; the first letter of the email when there is no name yet. */
export function initials(
  fullName: string | null | undefined,
  email = "",
): string {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2)
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email.trim()[0] ?? "?").toUpperCase();
}

const ITEMS = [
  {
    to: "/settings",
    label: "Settings",
    icon: <GearIcon className="h-4 w-4" />,
  },
  {
    to: "/onboarding",
    label: "Update my focus",
    icon: <HomeIcon className="h-4 w-4" />,
  },
  { to: "/help", label: "Help", icon: <HelpIcon className="h-4 w-4" /> },
  {
    to: "/privacy",
    label: "Privacy",
    icon: <ShieldIcon className="h-4 w-4" />,
  },
  { to: "/terms", label: "Terms", icon: <FileIcon className="h-4 w-4" /> },
];

/** The person's avatar in the top right corner, with a menu for their account. */
export function ProfileMenu() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const tour = useTour();
  const menuId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const name = (me?.full_name ?? "").trim();
  const first = firstName(me?.full_name);

  const items = () =>
    Array.from(
      boxRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );

  useEffect(() => setOpen(false), [location.pathname]); // leaving the page closes it

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(at + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(at - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const row =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent-soft focus:bg-accent-soft focus:outline-none";

  return (
    <div ref={boxRef} className="relative shrink-0" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        data-tour="profile"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu${name ? ` for ${name}` : ""}`}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-full bg-surface py-1.5 pl-1.5 pr-3 shadow-card hover:ring-1 hover:ring-accent sm:pr-4"
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-surface"
        >
          {initials(me?.full_name, me?.email)}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">
          {first || "Account"}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`hidden h-4 w-4 text-muted transition-transform sm:block ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-40 mt-2 w-64 rounded-2xl bg-surface p-2 shadow-card ring-1 ring-line"
        >
          <div className="px-3 pb-2 pt-1.5">
            {name && <p className="truncate text-sm font-semibold">{name}</p>}
            <p className="truncate text-xs text-muted">{me?.email}</p>
          </div>
          <hr className="mb-1 border-line" />
          {ITEMS.map((i) => (
            <Link
              key={i.to}
              to={i.to}
              role="menuitem"
              tabIndex={-1}
              className={row}
            >
              <span className="text-muted">{i.icon}</span>
              {i.label}
            </Link>
          ))}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={row}
            onClick={() => {
              setOpen(false);
              tour.start();
            }}
          >
            <span className="text-muted">
              <CompassIcon className="h-4 w-4" />
            </span>
            Take the tour
          </button>
          <hr className="my-1 border-line" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={`${row} text-red-700`}
            onClick={() =>
              logout.mutate(undefined, {
                onSuccess: () => navigate("/login"),
              })
            }
          >
            <LogoutIcon className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
