import {
  Building2,
  ChevronRight,
  CircleHelp,
  FileText,
  Gift,
  History,
  LogOut,
  Settings,
  Shield,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useLogout, useMe } from "../../api/hooks";
import { Avatar } from "./Avatar";

function Row({
  to,
  icon,
  label,
  hint,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-[56px] items-center gap-3 px-4 py-2 active:bg-canvas"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-dark">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{label}</span>
          {hint && <span className="block text-sm text-muted">{hint}</span>}
        </span>
        <ChevronRight className="h-5 w-5 text-muted" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** Everything that is not one of the three main places. */
export function ProfilePage() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const icon = "h-5 w-5";
  return (
    <main className="space-y-5 px-5">
      <h1 className="sr-only">Profile</h1>
      <section
        aria-label="You"
        className="flex items-center gap-4 rounded-[1.75rem] bg-surface p-5 shadow-card"
      >
        <Avatar name={me?.full_name} email={me?.email} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">
            {me?.full_name || "Your profile"}
          </p>
          <p className="truncate text-sm text-muted">{me?.email}</p>
        </div>
      </section>

      <ul className="divide-y divide-canvas overflow-hidden rounded-[1.75rem] bg-surface shadow-card">
        <Row
          to="/settings/profile"
          icon={<Settings className={icon} />}
          label="Settings"
          hint="Your details, password and CV"
        />
        <Row
          to="/sessions"
          icon={<History className={icon} />}
          label="Interview history"
        />
        {me?.startup_outreach && (
          <Row
            to="/startups"
            icon={<Building2 className={icon} />}
            label="Startup outreach"
            hint="Notes to startups, in your voice"
          />
        )}
        <Row
          to="/referrals"
          icon={<Gift className={icon} />}
          label="Invite friends"
        />
        <Row to="/help" icon={<CircleHelp className={icon} />} label="Help" />
      </ul>

      <ul className="divide-y divide-canvas overflow-hidden rounded-[1.75rem] bg-surface shadow-card">
        <Row to="/privacy" icon={<Shield className={icon} />} label="Privacy" />
        <Row to="/terms" icon={<FileText className={icon} />} label="Terms" />
      </ul>

      <button
        type="button"
        className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-[1.75rem] bg-surface font-medium text-red-700 shadow-card"
        onClick={() =>
          logout.mutate(undefined, { onSuccess: () => navigate("/login") })
        }
      >
        <LogOut className={icon} /> Sign out
      </button>
    </main>
  );
}
