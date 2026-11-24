import { useEffect, useState } from "react";

import { APP_SHELL } from "../api/session";
import { isNativeApp } from "./native";

/** Tells the person, calmly, that they have no connection. The apps keep working from what they
 *  last loaded; only things that need a server wait. Never shown on the website. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  if (online || !(APP_SHELL || isNativeApp())) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-ink px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-center text-sm text-surface"
    >
      You&apos;re offline. Showing what you last loaded; anything that needs the
      internet will wait.
    </div>
  );
}
