import { type FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";

import { useMe, useRequestLink } from "../../api/hooks";

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
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-gray-600">
        Meet Practice Assistant is for practice with a partner who knows the
        assistant is on.
      </p>
      {request.isSuccess ? (
        <p role="status" className="mt-6 rounded border p-4">
          Check your email for a sign-in link. It works once and expires in 15
          minutes.
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
            className="w-full rounded border px-3 py-2"
          />
          <button
            type="submit"
            disabled={request.isPending}
            className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50"
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
    </main>
  );
}
