import { type FormEvent, useId, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { currentEnv, isSupported } from "../../app/browserSupport";
import { isDesktopApp } from "../../app/desktop";
import { isMobileApp } from "../../app/native";
import { VerifiedOnPhone } from "./VerifiedOnPhone";

import { ApiError } from "../../api/client";
import { useResetPassword } from "../../api/hooks";
import { PasswordField } from "../../ui/PasswordField";
import { AuthLayout } from "../../ui/AuthLayout";
import { PasswordRules, passwordOk } from "./password";

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const matchId = useId();
  const reset = useResetPassword();
  const canUseSite =
    isSupported(currentEnv()) || isMobileApp() || isDesktopApp();
  if (reset.isSuccess && canUseSite) return <Navigate to="/" replace />;
  if (reset.isSuccess)
    return (
      <AuthLayout plain>
        <VerifiedOnPhone
          title="Your password is changed"
          line="Open the InterviewMeet app and sign in with your new password."
        />
      </AuthLayout>
    );

  const mismatch = confirm.length > 0 && confirm !== password;
  const ok = passwordOk(password) && confirm === password;
  const dead =
    !token ||
    (reset.error instanceof ApiError && reset.error.code === "invalid_link");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok && token) reset.mutate({ token, password });
  };

  return (
    <AuthLayout>
      <div>
        {dead ? (
          <>
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
              That link didn&apos;t work
            </h1>
            <p className="mt-2 text-muted">
              It may have expired or already been used.
            </p>
            <Link to="/forgot-password" className="btn-primary btn-lg mt-4">
              Request a new reset link
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
              Choose a new password
            </h1>
            <p className="mt-2 text-sm text-muted">
              You&apos;ll be signed in, and signed out everywhere else.
            </p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              <PasswordField
                label="New password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
              />
              <PasswordRules password={password} />
              <PasswordField
                label="Confirm new password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                describedBy={matchId}
                invalid={mismatch}
              />
              <p
                id={matchId}
                aria-live="polite"
                className="-mb-1 -mt-3 min-h-4 text-xs text-red-700"
              >
                {mismatch ? "The passwords don't match." : ""}
              </p>
              <button
                type="submit"
                disabled={!ok || reset.isPending}
                className="btn-primary btn-lg w-full"
              >
                {reset.isPending ? "Saving…" : "Save new password"}
              </button>
              {reset.isError && (
                <p role="alert" className="text-sm text-red-700">
                  {reset.error.message}
                </p>
              )}
            </form>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
