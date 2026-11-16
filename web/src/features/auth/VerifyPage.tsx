import { useEffect, useRef } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { useVerifyLink } from "../../api/hooks";
import { PublicShell } from "../../ui/PublicShell";

/** Lands from the emailed link. The token is single-use, so it must be sent exactly once even
 *  though React StrictMode runs effects twice in development. */
export function VerifyPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const verify = useVerifyLink();
  const started = useRef(false);

  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  if (verify.isSuccess) return <Navigate to="/" replace />;
  return (
    <PublicShell>
      <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
        <div className="card p-6 sm:p-8">
          {!token || verify.isError ? (
            <>
              <h1 className="text-3xl font-semibold tracking-tight">
                That link didn&apos;t work
              </h1>
              <p className="mt-2">It may have expired or already been used.</p>
              <Link to="/login" className="btn-primary mt-4">
                Request a new link
              </Link>
            </>
          ) : (
            <p role="status">Signing you in…</p>
          )}
        </div>
      </main>
    </PublicShell>
  );
}
