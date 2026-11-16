import { type FormEvent, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { API_BASE_URL } from "../../api/client";
import { useMe, useProviders, useRequestLink } from "../../api/hooks";
import { PublicShell } from "../../ui/PublicShell";

const GOOGLE_ERRORS: Record<string, string> = {
  google_failed:
    "Google sign-in didn't work. Please try again, or use an email link instead.",
  google_cancelled: "Google sign-in was cancelled.",
  google_unavailable: "Google sign-in isn't available right now.",
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** One form for both pages. Email-link sign-in creates the account on first use, so sign-up differs
 *  only in wording and in requiring the terms to be accepted before either method. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const { data: me } = useMe();
  const providers = useProviders();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const request = useRequestLink();
  if (me) return <Navigate to="/" replace />;

  const urlError = GOOGLE_ERRORS[params.get("error") ?? ""];
  const blocked = signup && !agreed;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!blocked) request.mutate(email.trim());
  };
  const google = () =>
    window.location.assign(`${API_BASE_URL}/api/auth/google/start`);

  return (
    <PublicShell>
      <main className="mx-auto max-w-md px-4 py-12 sm:py-16">
        <div className="card p-6 sm:p-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            {signup ? "Create your account" : "Sign in"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {signup
              ? "Practise interviews on Google Meet with a partner who knows the assistant is on."
              : "Welcome back. InterviewMeet is for practice with a partner who knows the assistant is on."}
          </p>

          {urlError && (
            <p role="alert" className="notice-error mt-4">
              {urlError}
            </p>
          )}

          {request.isSuccess ? (
            <p
              role="status"
              className="mt-6 rounded-xl bg-accent-soft p-4 text-accent-dark"
            >
              Check your email for a{" "}
              {signup ? "link to finish creating your account" : "sign-in link"}
              . It works once and expires in 15 minutes.
            </p>
          ) : (
            <>
              {signup && (
                <label className="mt-6 flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-accent"
                  />
                  <span>
                    I agree to the{" "}
                    <Link to="/terms" className="underline">
                      terms
                    </Link>{" "}
                    and accept the{" "}
                    <Link to="/privacy" className="underline">
                      privacy notice
                    </Link>
                    , and I will only practise with a partner who knows the
                    assistant is on.
                  </span>
                </label>
              )}

              {providers.data?.google && (
                <>
                  <button
                    type="button"
                    onClick={google}
                    disabled={blocked}
                    className="btn-secondary mt-5 w-full"
                  >
                    <GoogleMark /> Continue with Google
                  </button>
                  <div className="my-5 flex items-center gap-3 text-xs text-muted">
                    <span className="h-px flex-1 bg-line" /> or
                    <span className="h-px flex-1 bg-line" />
                  </div>
                </>
              )}

              <form
                onSubmit={submit}
                className={`space-y-3 ${providers.data?.google || signup ? "" : "mt-6"}`}
              >
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
                  disabled={request.isPending || blocked}
                  className="btn-primary w-full"
                >
                  {request.isPending
                    ? "Sending…"
                    : signup
                      ? "Create account with email"
                      : "Email me a sign-in link"}
                </button>
                {request.isError && (
                  <p role="alert" className="text-sm text-red-700">
                    {request.error.message}
                  </p>
                )}
              </form>
            </>
          )}

          <p className="mt-6 text-center text-sm text-muted">
            {signup ? (
              <>
                Already have an account?{" "}
                <Link
                  to="/login"
                  className="font-medium text-accent-dark underline"
                >
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New to InterviewMeet?{" "}
                <Link
                  to="/signup"
                  className="font-medium text-accent-dark underline"
                >
                  Create an account
                </Link>
              </>
            )}
          </p>
          {!signup && (
            <p className="mt-4 text-center text-xs text-muted">
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
          )}
        </div>
      </main>
    </PublicShell>
  );
}
