import { Navigate, Outlet } from "react-router-dom";

import { useMe } from "../../api/hooks";

export function AuthGuard() {
  const { data: me, isPending, isError } = useMe();
  if (isPending) return <p className="p-8">Loading…</p>;
  if (isError)
    return (
      <p className="p-8">
        Couldn&apos;t reach the server. Reload to try again.
      </p>
    );
  if (!me) return <Navigate to="/login" replace />;
  return <Outlet />;
}
