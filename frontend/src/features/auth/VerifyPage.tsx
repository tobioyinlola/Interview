import { useEffect, useRef } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { useVerifyLink } from "../../api/hooks";
import { AuthLayout } from "../../ui/AuthLayout";

const appLink = (code: string) =>
  `interviewmeet://auth?${new URLSearchParams({ code })}`;

/** Lands from the emailed link. The token is single-use, so it must be sent exactly once even
 *  though React StrictMode runs effects twice in development. If an installed app asked for the
 *  link, this browser is not signed in: it passes the result to the app instead. */
export function VerifyPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const verify = useVerifyLink();
  const started = useRef(false);
  const code =
    verify.data && "app_code" in verify.data ? verify.data.app_code : null;

  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  useEffect(() => {
    if (code) window.location.assign(appLink(code)); // opens the app by itself where allowed
  }, [code]);

  if (verify.isSuccess && !code) return <Navigate to="/" replace />;
  return (
    <AuthLayout>
      <div>
        {code ? (
          <>
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
              You&apos;re confirmed
            </h1>
            <p className="mt-2">
              Return to the InterviewMeet app to carry on. If it did not open by
              itself, tap the button.
            </p>
            <a href={appLink(code)} className="btn-primary btn-lg mt-4">
              Open InterviewMeet
            </a>
            <p className="mt-4 text-sm text-muted">
              Not on the device with the app? Your account is ready: sign in
              with your email and password in the app.
            </p>
          </>
        ) : !token || verify.isError ? (
          <>
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
              That link didn&apos;t work
            </h1>
            <p className="mt-2">It may have expired or already been used.</p>
            <Link to="/login" className="btn-primary btn-lg mt-4">
              Request a new link
            </Link>
          </>
        ) : (
          <p role="status">Signing you in…</p>
        )}
      </div>
    </AuthLayout>
  );
}
