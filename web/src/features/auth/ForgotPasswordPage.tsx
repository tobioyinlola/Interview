import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { useRequestReset } from "../../api/hooks";
import { AuthLayout } from "../../ui/AuthLayout";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const reset = useRequestReset();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    reset.mutate(email.trim());
  };
  return (
    <AuthLayout>
      <div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
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
            If that address has an account, a reset link is on its way. It works
            once and expires in 15 minutes.
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
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
              />
            </div>
            <button
              type="submit"
              disabled={reset.isPending}
              className="btn-primary btn-lg w-full"
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
          <Link to="/login" className="font-medium text-accent-dark underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
