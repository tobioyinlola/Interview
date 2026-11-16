import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { useRequestReset } from "../../api/hooks";
import { PublicShell } from "../../ui/PublicShell";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const reset = useRequestReset();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    reset.mutate(email.trim());
  };
  return (
    <PublicShell>
      <main className="mx-auto max-w-md px-4 py-10 sm:py-14">
        <div className="card p-6 sm:p-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-muted">
            Enter your email and we&apos;ll send you a link to choose a new
            password.
          </p>
          {reset.isSuccess ? (
            <p
              role="status"
              className="mt-6 rounded-xl bg-accent-soft p-4 text-accent-dark"
            >
              If that address has an account, a reset link is on its way. It
              works once and expires in 15 minutes.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium" htmlFor="email">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input mt-1 w-full"
                />
              </div>
              <button
                type="submit"
                disabled={reset.isPending}
                className="btn-primary w-full"
              >
                {reset.isPending ? "Sending…" : "Send reset link"}
              </button>
              {reset.isError && (
                <p role="alert" className="text-sm text-red-700">
                  {reset.error.message}
                </p>
              )}
            </form>
          )}
          <p className="mt-6 text-center text-sm text-muted">
            <Link
              to="/login"
              className="font-medium text-accent-dark underline"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      </main>
    </PublicShell>
  );
}
