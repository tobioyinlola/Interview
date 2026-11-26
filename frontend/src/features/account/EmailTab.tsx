import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useMailbox, useMailboxActions } from "../autoapply/api";
import { AppPasswordForm } from "../autoapply/AppPasswordForm";

/** The only places the app will send someone back to after connecting: never an address a link supplied. */
const NEXT: Record<string, string> = {
  "/startups": "Continue to startup outreach",
  "/auto-apply/setup": "Continue to Auto-Apply setup",
};

/** The email connection lives here, and nowhere else: connect Gmail or use an app password, see what
 *  is connected, disconnect. Startup outreach and Auto-Apply send from this address and read
 *  replies from it. */
export function EmailTab() {
  const box = useMailbox();
  const { connect, disconnect, check } = useMailboxActions();
  const [params] = useSearchParams();
  const [changing, setChanging] = useState(false);
  const next = NEXT[params.get("next") ?? ""] ? params.get("next")! : null;
  if (box.isPending)
    return (
      <p role="status" className="text-muted">
        Loading your email…
      </p>
    );
  if (box.isError || !box.data)
    return (
      <p role="alert" className="notice-error">
        Your email connection could not be loaded. Try again in a moment.
      </p>
    );
  const b = box.data;
  const canGoogle = b.can_connect !== false;
  const canPassword = (b.smtp_providers?.length ?? 0) > 0;
  const needsAgain = b.status === "reauth_needed";

  const forms = (
    <div className="space-y-3">
      {canGoogle && (
        <div>
          <button
            type="button"
            className="btn-primary"
            disabled={connect.isPending}
            onClick={() => connect.mutate()}
          >
            Connect Gmail
          </button>
          {connect.isError && (
            <p role="alert" className="notice-error mt-2">
              Gmail could not be connected right now. Try again in a moment.
            </p>
          )}
        </div>
      )}
      {canPassword && (
        <>
          {canGoogle && (
            <p className="text-sm text-muted">
              Or use an app password: it works with Gmail, Outlook and Yahoo,
              and any other address those providers host.
            </p>
          )}
          <AppPasswordForm onDone={() => setChanging(false)} />
        </>
      )}
      {!canGoogle && !canPassword && (
        <p className="text-sm text-muted">
          Connecting email is not set up on this server yet.
        </p>
      )}
    </div>
  );

  return (
    <section aria-labelledby="email-h" className="card space-y-4">
      <div>
        <h2 id="email-h" className="text-lg font-semibold">
          Your email
        </h2>
        <p className="mt-1 text-sm text-muted">
          Startup pitches and emailed applications go out from your own address
          and show in your Sent folder. Replies are noticed here too. We read
          nothing else, and the messages stay in your inbox.
        </p>
      </div>

      {b.connected ? (
        <div
          aria-label="Email connected"
          className={`space-y-3 rounded-2xl p-4 ${
            needsAgain
              ? "bg-amber-50 text-amber-950"
              : "bg-emerald-50 text-emerald-950"
          }`}
        >
          <p className="font-semibold">
            {needsAgain ? "Needs to be connected again" : "Connected"}
          </p>
          <p className="break-all font-medium">{b.address}</p>
          {needsAgain && (
            <p className="text-sm">
              {b.address} stopped accepting the saved sign-in. Connect it again
              below.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {next && !needsAgain && (
              <Link to={next} className="btn-primary">
                {NEXT[next]}
              </Link>
            )}
            <button
              type="button"
              className="btn-secondary"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              {check.isPending ? "Checking…" : "Check it works"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setChanging((v) => !v)}
              aria-expanded={changing || needsAgain}
            >
              Use a different email
            </button>
            <button
              type="button"
              className="btn-danger-outline"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
          {check.isSuccess && (
            <p role="status" className="text-sm">
              {check.data.connected && check.data.status !== "reauth_needed"
                ? "It works: we could sign in. Nothing was sent."
                : "We could not sign in. Connect it again."}
            </p>
          )}
          {disconnect.isError && (
            <p role="alert" className="notice-error">
              {disconnect.error.message}
            </p>
          )}
        </div>
      ) : (
        <p className="rounded-2xl bg-accent-soft p-4 text-sm">
          Nothing is connected yet.
          {next ? " Connect an email to carry on." : ""}
        </p>
      )}

      {(!b.connected || changing || needsAgain) && forms}
    </section>
  );
}
