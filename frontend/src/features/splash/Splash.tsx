import { useEffect, useState } from "react";

import { isNativeApp } from "../../app/native";
import { hideNativeSplash } from "./nativeSplash";

const KEY = "im-splash";
const HOLD_MS = 2400; // how long the sequence plays before it lifts away
const EXIT_MS = 500;

/** Should the opening animation play? Once per launch of an installed app: not on the website, not
 *  when the browser has just handed a sign-in back to the app (that must not be delayed), and not
 *  again as the person moves around. */
function shouldPlay(): boolean {
  if (!isNativeApp()) return false;
  if (
    import.meta.env.MODE === "test" &&
    !(window as { __splash?: boolean }).__splash
  )
    return false;
  if (/^\/(auth\/app|login\/verify)/.test(window.location.pathname))
    return false;
  try {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, "done");
  } catch {
    /* no memory: it plays, and a reload plays it again */
  }
  return true;
}

const WORD = "InterviewMeet";

/** The apps' opening animation: the logo draws itself in, then the app appears. Tap to skip. */
export function Splash() {
  const [phase, setPhase] = useState<"play" | "out" | "gone">(() =>
    shouldPlay() ? "play" : "gone",
  );
  useEffect(() => {
    hideNativeSplash(); // our first frame is up: let the phone's own splash fade into it
  }, []);
  useEffect(() => {
    if (phase !== "play") return;
    const t = setTimeout(() => setPhase("out"), HOLD_MS);
    return () => clearTimeout(t);
  }, [phase]);
  useEffect(() => {
    if (phase !== "out") return;
    const t = setTimeout(() => setPhase("gone"), EXIT_MS);
    return () => clearTimeout(t);
  }, [phase]);
  if (phase === "gone") return null;
  return (
    <div
      className={`sp ${phase === "out" ? "sp-out" : ""}`}
      data-testid="splash"
      aria-hidden="true"
      onClick={() => setPhase("out")}
    >
      <div className="sp-stage">
        <svg viewBox="-8 -8 48 48" className="h-32 w-32" role="presentation">
          <defs>
            <radialGradient id="sp-g" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#7B47F3" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#7B47F3" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle
            className="sp-glow"
            cx="16"
            cy="16"
            r="26"
            fill="url(#sp-g)"
          />
          <circle
            className="sp-ring"
            cx="16"
            cy="16"
            r="21"
            fill="none"
            stroke="#B9A0FF"
            strokeWidth="0.7"
            strokeLinecap="round"
            transform="rotate(-90 16 16)"
          />
          <g className="sp-tile">
            <rect width="32" height="32" rx="9" fill="#7B47F3" />
            <path
              className="sp-bubble"
              d="M8 9.5A2.5 2.5 0 0 1 10.5 7h11A2.5 2.5 0 0 1 24 9.5v8a2.5 2.5 0 0 1-2.5 2.5H15l-4.2 3.6c-.5.4-1.3.1-1.3-.6V20A2.5 2.5 0 0 1 8 17.5z"
              fill="#fff"
            />
            <g fill="#7B47F3">
              <rect
                className="sp-bar"
                style={{ ["--i" as string]: 0 }}
                x="12"
                y="11.5"
                width="1.8"
                height="5"
                rx=".9"
              />
              <rect
                className="sp-bar"
                style={{ ["--i" as string]: 1 }}
                x="15.1"
                y="10"
                width="1.8"
                height="8"
                rx=".9"
              />
              <rect
                className="sp-bar"
                style={{ ["--i" as string]: 2 }}
                x="18.2"
                y="12.5"
                width="1.8"
                height="3"
                rx=".9"
              />
            </g>
          </g>
        </svg>
        <p className="sp-word">
          {WORD.split("").map((ch, i) => (
            <span
              key={i}
              className={`sp-letter ${i >= 9 ? "sp-meet" : ""}`}
              style={{ ["--i" as string]: i }}
            >
              {ch}
            </span>
          ))}
        </p>
        <p className="sp-line">Your interview, prepared.</p>
      </div>
    </div>
  );
}
