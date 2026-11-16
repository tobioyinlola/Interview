import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { useLogout, useMe } from "../api/hooks";

const link = ({ isActive }: { isActive: boolean }) =>
  `px-2 py-1 rounded ${isActive ? "bg-accent-soft font-medium text-accent-dark" : "hover:underline"}`;

export function Layout() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <>
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <strong className="mr-4">InterviewMeet</strong>
        <nav aria-label="Main" className="flex gap-1">
          <NavLink to="/dashboard" end className={link}>
            Dashboard
          </NavLink>
          <NavLink to="/notes" className={link}>
            Notes
          </NavLink>
          <NavLink to="/companies" className={link}>
            Companies
          </NavLink>
          <NavLink to="/session/new" className={link}>
            Practice
          </NavLink>
          <NavLink to="/sessions" className={link}>
            Sessions
          </NavLink>
          {me?.is_admin && (
            <NavLink to="/admin/usage" className={link}>
              Usage
            </NavLink>
          )}
          <NavLink to="/settings" className={link}>
            Settings
          </NavLink>
        </nav>
        <span className="ml-auto text-sm text-gray-600">{me?.email}</span>
        <button
          className="rounded border px-2 py-1 text-sm"
          onClick={() =>
            logout.mutate(undefined, { onSuccess: () => navigate("/login") })
          }
        >
          Sign out
        </button>
      </header>
      <Outlet />
      <footer className="mt-8 border-t p-4 text-center text-xs text-gray-600">
        <Link to="/terms" className="underline">
          Terms
        </Link>{" "}
        ·{" "}
        <Link to="/privacy" className="underline">
          Privacy
        </Link>
      </footer>
    </>
  );
}
