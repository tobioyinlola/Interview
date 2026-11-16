import { type FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { useMe, useRequestLink } from "../../api/hooks";
import { PublicShell } from "../../ui/PublicShell";

export function SignInForm() {
  const { data: me } = useMe();
  const [email, setEmail] = useState("");
  const request = useRequestLink();
  if (me) return <Navigate to="/" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    request.mutate(email.trim());
  };

  return (
    <PublicShell>
      <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
        <div className="card p-6 sm:p-8">
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-muted">
            InterviewMeet is for practice with a partner who knows the assistant
            is on.
          </p>
          {request.isSuccess ? (
            <p
              role="status"
              className="mt-6 rounded-xl bg-accent-soft p-4 text-accent-dark"
            >
              Check your email for a sign-in link. It works once and expires in
              15 minutes.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-3">
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
                className="input w-full"
              />
              <button
                type="submit"
                disabled={request.isPending}
                className="btn-primary"
              >
                {request.isPending ? "Sending…" : "Email me a sign-in link"}
              </button>
              {request.isError && (
                <p role="alert" className="text-sm text-red-700">
                  {request.error.message}
                </p>
              )}
            </form>
          )}
          <p className="mt-6 text-xs text-muted">
            By signing in you agree to the{" "}
            <Link to="/terms" className="underline">
              terms
            </Link>{" "}
            and accept the{" "}
            <Link to="/privacy" className="underline">
              privacy notice
            </Link>
            . Practice only, with a partner who knows the assistant is on.
          </p>
        </div>
      </main>
    </PublicShell>
  );
}
