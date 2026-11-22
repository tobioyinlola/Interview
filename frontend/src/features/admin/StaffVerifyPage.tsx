import { useEffect, useRef } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { StaffShell } from "./StaffShell";
import { useStaffVerify } from "./staff";

/** Lands from the emailed back-office link. The token is single-use, so it is sent exactly once. */
export function StaffVerifyPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const verify = useStaffVerify();
  const started = useRef(false);

  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  if (verify.isSuccess) return <Navigate to="/admin" replace />;
  return (
    <StaffShell>
      {!token || verify.isError ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            That link didn&apos;t work
          </h1>
          <p className="mt-2">It may have expired or already been used.</p>
          <Link to="/admin/login" className="btn-primary btn-lg mt-4">
            Back to staff sign in
          </Link>
        </>
      ) : (
        <p role="status">Signing you in…</p>
      )}
    </StaffShell>
  );
}
