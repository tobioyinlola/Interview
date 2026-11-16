import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useLogout, useMe } from "../api/hooks";

const link = ({ isActive }: { isActive: boolean }) =>
  `px-2 py-1 rounded ${isActive ? "bg-blue-100 font-medium" : "hover:underline"}`;

export function Layout() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <>
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <strong className="mr-4">Meet Practice Assistant</strong>
        <nav aria-label="Main" className="flex gap-1">
          <NavLink to="/" end className={link}>
            Dashboard
          </NavLink>
          <NavLink to="/notes" className={link}>
            Notes
          </NavLink>
          <NavLink to="/companies" className={link}>
            Companies
          </NavLink>
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
    </>
  );
}
