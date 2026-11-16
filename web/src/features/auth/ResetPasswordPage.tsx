import { type FormEvent, useId, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import { useResetPassword } from "../../api/hooks";
import { PasswordField } from "../../ui/PasswordField";
import { PublicShell } from "../../ui/PublicShell";
import { MIN_PASSWORD } from "./AuthForm";

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const matchId = useId();
  const reset = useResetPassword();
  if (reset.isSuccess) return <Navigate to="/" replace />;

  const mismatch = confirm.length > 0 && confirm !== password;
  const ok = password.length >= MIN_PASSWORD && confirm === password;
  const dead =
    !token ||
    (reset.error instanceof ApiError && reset.error.code === "invalid_link");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok && token) reset.mutate({ token, password });
  };

  return (
    <PublicShell>
      <main className="mx-auto max-w-md px-4 py-10 sm:py-14">
        <div className="card p-6 sm:p-8">
          {dead ? (
            <>
              <h1 className="text-3xl font-semibold tracking-tight">
                That link didn&apos;t work
              </h1>
              <p className="mt-2 text-muted">
                It may have expired or already been used.
              </p>
              <Link to="/forgot-password" className="btn-primary mt-4">
                Request a new reset link
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-semibold tracking-tight">
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
                <p
                  className={`-mt-2 text-xs ${password.length >= MIN_PASSWORD ? "text-green-700" : "text-muted"}`}
                >
                  {password.length >= MIN_PASSWORD ? "✓ " : ""}At least{" "}
                  {MIN_PASSWORD} characters.
                </p>
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
                  className="-mt-2 min-h-4 text-xs text-red-700"
                >
                  {mismatch ? "The passwords don't match." : ""}
                </p>
                <button
                  type="submit"
                  disabled={!ok || reset.isPending}
                  className="btn-primary w-full"
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
      </main>
    </PublicShell>
  );
}
