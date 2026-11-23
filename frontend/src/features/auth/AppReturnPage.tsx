import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "../../api/client";
import { AuthLayout } from "../../ui/AuthLayout";
import { takeVerifier } from "./nativeGoogle";
import { markVerified } from "./VerifiedToast";

const MESSAGES: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled.",
  google_unavailable: "Google sign-in isn't available right now.",
};

/** Where an installed app lands after the browser finishes Google sign-in: swaps the one-time code
 *  for a session, then goes to the dashboard. */
export function AppReturnPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const code = params.get("code");
  const failure = params.get("error");
  const [state, setState] = useState<"working" | "done" | "failed">(
    code && !failure ? "working" : "failed",
  );
  const [message, setMessage] = useState(
    failure
      ? (MESSAGES[failure] ??
          "Google sign-in didn't work. Please try again, or use your email instead.")
      : "",
  );
  const started = useRef(false);

  useEffect(() => {
    if (!code || failure || started.current) return;
    started.current = true; // a code works once: never send it twice
    const verifier = takeVerifier();
    if (!verifier) {
      setState("failed");
      setMessage(
        "That sign-in expired. If you just confirmed your email, your account is ready: sign in.",
      );
      return;
    }
    apiFetch("/api/auth/app-exchange", {
      method: "POST",
      body: JSON.stringify({ code, verifier }),
    })
      .then(async () => {
        await qc.invalidateQueries({ queryKey: ["me"] });
        markVerified(); // the next screen says "Your email is verified, you're signed in"
        setState("done");
      })
      .catch((e: unknown) => {
        setState("failed");
        setMessage(
          e instanceof ApiError && e.code === "invalid_code"
            ? "That sign-in expired. If you just confirmed your email, your account is ready: sign in."
            : "We couldn't finish signing you in. Please try again.",
        );
      });
  }, [code, failure, qc]);

  if (state === "done") return <Navigate to="/dashboard" replace />;
  return (
    <AuthLayout plain>
      {state === "working" ? (
        <p role="status" className="text-center text-muted">
          Signing you in…
        </p>
      ) : (
        <div className="space-y-4">
          <p role="alert" className="notice-error">
            {message}
          </p>
          <Link to="/login" className="btn-primary inline-block">
            Back to sign in
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
