import { useState } from "react";

import { useMe } from "../../api/hooks";
import { useMailbox, useMailboxActions } from "./api";
import { AppPasswordForm } from "./AppPasswordForm";

const KEY = "im-gmail-prompt-dismissed";
const dismissed = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage can be unavailable: the card just shows again
  }
};

/** One short card: send from your own Gmail, so everything shows in your Sent folder. Shown until
 *  they connect it or say not now. */
export function ConnectGmail() {
  const { data: me } = useMe();
  const box = useMailbox();
  const { connect } = useMailboxActions();
  const [hidden, setHidden] = useState(dismissed);
  const [password, setPassword] = useState(false);
  const canPassword = (box.data?.smtp_providers?.length ?? 0) > 0;
  if (
    hidden ||
    !me?.autoapply ||
    !box.data ||
    box.data.connected ||
    (box.data.can_connect === false && !canPassword)
  )
    return null;
  const google = box.data.can_connect !== false;
  return (
    <section
      aria-labelledby="gmail-h"
      className="rounded-2xl bg-accent-soft p-5"
    >
      <h2 id="gmail-h" className="text-lg font-semibold">
        Send from your own Gmail
      </h2>
      <p className="mt-1 text-sm text-muted">
        Applications and pitches go out from your address and show in your Sent
        folder. We never read anything else.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {google && (
          <button
            type="button"
            className="btn-primary"
            disabled={connect.isPending}
            onClick={() => connect.mutate()}
          >
            Connect Gmail
          </button>
        )}
        {canPassword && (
          <button
            type="button"
            className={google ? "btn-secondary" : "btn-primary"}
            aria-expanded={password || !google}
            onClick={() => setPassword(true)}
          >
            Use an app password
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            try {
              localStorage.setItem(KEY, "1");
            } catch {
              /* not remembered */
            }
            setHidden(true);
          }}
        >
          Not now
        </button>
      </div>
      {canPassword && (password || !google) && (
        <AppPasswordForm onDone={() => setPassword(false)} />
      )}
      {connect.isError && (
        <p role="alert" className="notice-error mt-2">
          Gmail could not be connected right now. Try again in a moment.
        </p>
      )}
    </section>
  );
}
