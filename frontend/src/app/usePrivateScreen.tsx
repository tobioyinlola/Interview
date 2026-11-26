import { type ReactNode, useEffect } from "react";

import { privacy, usePrivacy } from "./privacy";

/** Mark the screen that calls this as private while it is open. Returns whether its personal
 *  details must be hidden right now (Presentation mode, or an iPhone being recorded or mirrored
 *  with protection on). */
export function usePrivateScreen(): boolean {
  useEffect(() => {
    privacy.enterPrivate();
    return () => privacy.leavePrivate();
  }, []);
  return usePrivacy(
    (s) => s.presentation || (s.captured && s.enabled && !s.live),
  );
}

/** A private screen's content, hidden (not blacked out: replaced) when it must be. */
export function PrivateScreen({ children }: { children: ReactNode }) {
  const hide = usePrivateScreen();
  if (!hide) return <>{children}</>;
  return (
    <section
      role="status"
      aria-label="Private content hidden"
      className="card mx-auto my-8 max-w-md space-y-2 text-center"
    >
      <h2 className="text-lg font-semibold">Private details hidden</h2>
      <p className="text-sm text-muted">
        Your screen is being shared, recorded or mirrored, or Presentation mode
        is on. This page holds personal details, so it is hidden until that
        stops. You can turn Presentation mode off in Settings, Privacy.
      </p>
    </section>
  );
}
