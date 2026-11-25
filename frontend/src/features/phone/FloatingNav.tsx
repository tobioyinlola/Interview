import { House, Rocket, Send } from "lucide-react";
import { NavLink } from "react-router-dom";

/** The phone app's whole navigation: three icons in a floating bar. The middle one, the thing the
 *  app is for, is raised. Everything else (sessions, settings, help...) lives under the profile. */
export function FloatingNav({
  autoapply,
  outreach,
}: {
  autoapply: boolean;
  outreach: boolean;
}) {
  const side =
    "relative flex h-12 w-16 items-center justify-center rounded-full transition-colors";
  const dot = (on: boolean) =>
    on ? (
      <span
        aria-hidden="true"
        className="absolute bottom-0.5 h-1 w-1 rounded-full bg-accent-dark"
      />
    ) : null;
  return (
    <nav
      aria-label="Tabs"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-6 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <ul className="pointer-events-auto flex w-full max-w-xs items-center justify-between rounded-full bg-surface px-5 py-2 shadow-lift">
        <li>
          <NavLink
            to="/dashboard"
            aria-label="Home"
            className={({ isActive }) =>
              `${side} ${isActive ? "text-accent-dark" : "text-muted"}`
            }
          >
            {({ isActive }) => (
              <>
                <House className="h-6 w-6" strokeWidth={2} />
                {dot(isActive)}
              </>
            )}
          </NavLink>
        </li>
        <li className="-mt-9">
          <NavLink
            to={autoapply ? "/auto-apply" : "/sessions"}
            aria-label={autoapply ? "Auto-Apply" : "Sessions"}
            className={({ isActive }) =>
              `flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-ink to-accent-dark text-surface shadow-lift ring-[6px] ring-canvas transition-transform active:scale-95 ${
                isActive ? "to-accent" : ""
              }`
            }
          >
            <Rocket className="h-7 w-7" strokeWidth={2} />
          </NavLink>
        </li>
        <li>
          <NavLink
            to={outreach ? "/startups" : "/sessions"}
            aria-label={outreach ? "Startups" : "History"}
            className={({ isActive }) =>
              `${side} ${isActive ? "text-accent-dark" : "text-muted"}`
            }
          >
            {({ isActive }) => (
              <>
                <Send className="h-6 w-6" strokeWidth={2} />
                {dot(isActive)}
              </>
            )}
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
