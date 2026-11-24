import { type FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";

import { PasswordField } from "../../ui/PasswordField";
import { StaffShell } from "./StaffShell";
import { useStaff, useStaffLink, useStaffLogin } from "./staff";

/** The back office sign-in: staff email and password, or an emailed one-time link. */
export function StaffLoginPage() {
  const { data: staff, isPending } = useStaff();
  const login = useStaffLogin();
  const link = useStaffLink();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (isPending) return null;
  if (staff) return <Navigate to="/admin" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email: email.trim(), password });
  };
  const emailLink = () => {
    if (email.trim()) link.mutate(email.trim());
  };

  return (
    <StaffShell>
      <h1 className="text-2xl font-semibold tracking-tight">Staff sign in</h1>
      <p className="mt-1 text-sm text-muted">
        Use your work email and password, or get a one-time link by email.
      </p>
      {link.isSuccess ? (
        <p role="status" className="notice-success mt-4">
          If that address is on the staff list, a sign-in link is on its way. It
          works once and expires soon.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="staff-email" className="block text-sm font-medium">
              Work email
            </label>
            <input
              id="staff-email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input mt-1 w-full"
            />
          </div>
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          {(login.error || link.error) && (
            <p role="alert" className="notice-error">
              {(login.error ?? link.error)?.message}
            </p>
          )}
          <button
            type="submit"
            className="btn-primary btn-lg w-full"
            disabled={login.isPending || !password}
          >
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={emailLink}
            disabled={link.isPending || !email.trim()}
          >
            Email me a sign-in link instead
          </button>
        </form>
      )}
    </StaffShell>
  );
}
