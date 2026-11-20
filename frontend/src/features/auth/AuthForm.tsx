import { type FormEvent, useId, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { API_BASE_URL } from "../../api/client";
import {
  useLogin,
  useMe,
  useProviders,
  useRequestLink,
  useSignUp,
} from "../../api/hooks";
import { savedInvite } from "../referral/invite";
import { PasswordField } from "../../ui/PasswordField";
import { AuthLayout } from "../../ui/AuthLayout";

export const MIN_PASSWORD = 10;

const GOOGLE_ERRORS: Record<string, string> = {
  google_failed:
    "Google sign-in didn't work. Please try again, or use your email instead.",
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

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted">
      <span className="h-px flex-1 bg-line" /> or
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Log in and sign up on one form component. Signing up needs an email, a password typed twice, and
 *  the terms accepted; the account only exists once the emailed link is opened. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const { data: me } = useMe();
  const providers = useProviders();
  const [params] = useSearchParams();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const matchId = useId();
  const create = useSignUp();
  const login = useLogin();
  const link = useRequestLink();
  if (me) return <Navigate to="/" replace />;

  const urlError = GOOGLE_ERRORS[params.get("error") ?? ""];
  const longEnough = password.length >= MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const nameOk = fullName.trim().length >= 2;
  const canCreate = nameOk && longEnough && confirm === password && agreed;
  const sent = create.isSuccess || link.isSuccess;
  const failure = (signup ? create.error : login.error) ?? link.error;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (signup) {
      if (canCreate)
        create.mutate({
          email: email.trim(),
          password,
          full_name: fullName.trim(),
        });
    } else {
      login.mutate({ email: email.trim(), password });
    }
  };
  const emailLink = () => {
    if (emailRef.current?.reportValidity()) link.mutate(email.trim());
  };
  const google = () =>
    window.location.assign(
      `${API_BASE_URL}/api/auth/google/start${
        savedInvite() ? `?ref=${savedInvite()}` : ""
      }`,
    );

  return (
    <AuthLayout>
      <div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
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

        {sent ? (
          <p
            role="status"
            className="mt-6 rounded-xl bg-accent-soft p-4 text-accent-dark"
          >
            Check your email for a{" "}
            {signup
              ? "link to confirm your address and finish creating your account"
              : "sign-in link"}
            . It works once and expires in 15 minutes.
          </p>
        ) : (
          <>
            <form onSubmit={submit} className="mt-6 space-y-4">
              {signup && (
                <div>
                  <label
                    className="block text-sm font-medium"
                    htmlFor="full-name"
                  >
                    Full name
                  </label>
                  <input
                    id="full-name"
                    required
                    autoComplete="name"
                    autoCapitalize="words"
                    maxLength={120}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="input mt-1 w-full"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium" htmlFor="email">
                  Email address
                </label>
                <input
                  id="email"
                  ref={emailRef}
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
                  enterKeyHint="next"
                />
              </div>

              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                autoComplete={signup ? "new-password" : "current-password"}
                describedBy={signup ? hintId : undefined}
              />
              {signup && (
                <>
                  <p
                    id={hintId}
                    className={`-mt-2 text-xs ${longEnough ? "text-green-700" : "text-muted"}`}
                  >
                    {longEnough ? "✓ " : ""}At least {MIN_PASSWORD} characters.
                    A few words together works well.
                  </p>
                  <PasswordField
                    label="Confirm password"
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

                  <label className="flex items-start gap-3 py-1 text-sm leading-relaxed">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="mt-0.5 h-6 w-6 shrink-0 accent-accent"
                    />
                    <span>
                      I agree to the{" "}
                      <Link to="/terms" className="underline">
                        Terms and Conditions
                      </Link>{" "}
                      and the{" "}
                      <Link to="/privacy" className="underline">
                        Privacy Notice
                      </Link>
                      , and I will only practise with a partner who knows the
                      assistant is on.
                    </span>
                  </label>
                </>
              )}

              <button
                type="submit"
                disabled={
                  signup ? !canCreate || create.isPending : login.isPending
                }
                className="btn-primary btn-lg w-full"
              >
                {signup
                  ? create.isPending
                    ? "Creating…"
                    : "Create account"
                  : login.isPending
                    ? "Signing in…"
                    : "Sign in"}
              </button>
              {failure && (
                <p role="alert" className="text-sm text-red-700">
                  {failure.message}
                </p>
              )}
            </form>

            {!signup && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <Link
                  to="/forgot-password"
                  className="inline-flex min-h-[44px] items-center text-accent-dark underline"
                >
                  Forgot password?
                </Link>
                <button
                  type="button"
                  onClick={emailLink}
                  disabled={link.isPending}
                  className="inline-flex min-h-[44px] items-center text-accent-dark underline disabled:opacity-50"
                >
                  Email me a sign-in link
                </button>
              </div>
            )}

            {providers.data?.google && (
              <>
                <Divider />
                <button
                  type="button"
                  onClick={google}
                  disabled={signup && !agreed}
                  className="btn-secondary btn-lg w-full"
                >
                  <GoogleMark /> Continue with Google
                </button>
                {signup && !agreed && (
                  <p className="mt-2 text-center text-xs text-muted">
                    Accept the terms above to continue with Google.
                  </p>
                )}
              </>
            )}
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
    </AuthLayout>
  );
}
