import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useMe } from "../../api/hooks";

export function AuthGuard() {
  const { data: me, isPending, isError } = useMe();
  const { pathname } = useLocation();
  if (isPending) return <p className="p-8 text-muted">Loading…</p>;
  if (isError)
    return (
      <p className="p-8 text-muted">
        Couldn&apos;t reach the server. Reload to try again.
      </p>
    );
  if (!me) return <Navigate to="/login" replace />;
  // Straight after sign-up the person is taken through onboarding once (they can skip it).
  if (me.onboarded === false && pathname !== "/onboarding")
    return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}
