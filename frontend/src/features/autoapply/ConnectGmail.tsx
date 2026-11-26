import { useState } from "react";
import { Link } from "react-router-dom";

import { useMe } from "../../api/hooks";
import { useMailbox } from "./api";

const KEY = "im-gmail-prompt-dismissed";
const dismissed = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage can be unavailable: the card just shows again
  }
};

/** One short card pointing at Settings: send from your own email, so everything shows in your Sent
 *  folder. The connection itself lives in Settings. Shown until they connect or say not now. */
export function ConnectGmail() {
  const { data: me } = useMe();
  const box = useMailbox();
  const [hidden, setHidden] = useState(dismissed);
  const possible =
    box.data?.can_connect !== false ||
    (box.data?.smtp_providers?.length ?? 0) > 0;
  if (hidden || !me?.autoapply || !box.data || box.data.connected || !possible)
    return null;
  return (
    <section
      aria-labelledby="gmail-h"
      className="rounded-2xl bg-accent-soft p-5"
    >
      <h2 id="gmail-h" className="text-lg font-semibold">
        Send from your own email
      </h2>
      <p className="mt-1 text-sm text-muted">
        Applications and pitches go out from your address and show in your Sent
        folder. We never read anything else. Connect it in Settings.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to="/settings/email" className="btn-primary">
          Connect email
        </Link>
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
    </section>
  );
}
