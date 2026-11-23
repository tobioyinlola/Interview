import { useEffect, useRef } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { useVerifyLink } from "../../api/hooks";
import { isDesktopApp } from "../../app/desktop";
import { currentEnv, isSupported } from "../../app/browserSupport";
import { isMobileApp } from "../../app/native";
import { AuthLayout } from "../../ui/AuthLayout";
import { VerifiedOnPhone } from "./VerifiedOnPhone";

const appLink = (code: string) =>
  `interviewmeet://auth?${new URLSearchParams({ code })}`;

/** Lands from the emailed link. The token is single-use, so it must be sent exactly once even
 *  though React StrictMode runs effects twice in development.
 *
 *  This page works in any browser, a phone's included. If an installed app asked for the link, this
 *  browser is not signed in: it passes the result to the app instead. If the browser cannot run the
 *  rest of the website (a phone), it says the account is ready and points to the app. */
export function VerifyPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const verify = useVerifyLink();
  const started = useRef(false);
  const code =
    verify.data && "app_code" in verify.data ? verify.data.app_code : null;
  const canUseSite =
    isSupported(currentEnv()) || isMobileApp() || isDesktopApp();

  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  useEffect(() => {
    if (code) window.location.assign(appLink(code)); // opens the app by itself where allowed
  }, [code]);

  if (verify.isSuccess && !code && canUseSite)
    return <Navigate to="/" replace />;
  return (
    <AuthLayout plain>
      {code ? (
        <VerifiedOnPhone
          title="Your email is verified"
          line="Opening InterviewMeet to sign you in. If it does not open by itself, tap the button."
          link={appLink(code)}
        />
      ) : verify.isSuccess ? (
        <VerifiedOnPhone
          title="Your email is verified"
          line="Your account is ready. Open the InterviewMeet app and sign in with your email and password."
        />
      ) : !token || verify.isError ? (
        <div>
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
            That link didn&apos;t work
          </h1>
          <p className="mt-2">It may have expired or already been used.</p>
          <Link to="/login" className="btn-primary btn-lg mt-4">
            Request a new link
          </Link>
        </div>
      ) : (
        <p role="status">Signing you in…</p>
      )}
    </AuthLayout>
  );
}
