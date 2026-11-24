import { useStealthHud } from "./useStealthHud";
import { useLiveStore } from "./store";

// -webkit-app-region is an Electron/Chromium-only CSS property that controls
// which parts of the window are draggable.  It is not in React's CSSProperties
// by default, so we extend the type locally.
declare module "react" {
  interface CSSProperties {
    WebkitAppRegion?: "drag" | "no-drag";
  }
}

/** A compact stealth HUD banner shown at the top of the live session page
 *  when running inside the Electron desktop app.
 *
 *  Stealth OFF: Shows a single "Enter Stealth HUD" button that morphs the
 *  window into a floating, screen-share-excluded overlay.
 *
 *  Stealth ON: Shows a minimal control bar with status, click-through toggle,
 *  and exit button — all within the compact 420×560 HUD window.
 *
 *  Rendered as null in the browser (non-desktop) and when the HUD is not
 *  supported by the installed Electron version. */
export function StealthHudBar({
  onEnd,
}: {
  /** Called when the user exits both stealth mode AND ends the session. */
  onEnd?: () => void;
}) {
  const { supported, state, enter, exit, toggleClickThrough } = useStealthHud();
  const status = useLiveStore((s) => s.status);
  const sessionEnded = status === "ended";

  if (!supported) return null;

  if (!state.active) {
    // Normal mode: offer entry into stealth HUD.
    return (
      <div className="flex items-center gap-3 rounded-xl border border-accent/20 bg-accent-soft px-4 py-3">
        <span className="flex-1 text-sm text-ink">
          <strong className="text-accent-dark">Desktop stealth available.</strong>{" "}
          Shrink to a floating HUD, hidden from screen share and proctoring tools.
        </span>
        <button
          type="button"
          className="btn-primary btn-sm whitespace-nowrap"
          onClick={() => void enter()}
          disabled={sessionEnded}
        >
          Enter Stealth HUD
        </button>
      </div>
    );
  }

  // Stealth / HUD mode: minimal always-visible control strip.
  return (
    <div
      className="stealth-hud-bar flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
      style={{
        // Drag the HUD by grabbing this bar.
        WebkitAppRegion: "drag",
        background: "rgba(28, 27, 46, 0.92)",
        color: "#f7f4ff",
        userSelect: "none",
      }}
    >
      {/* Status pill */}
      <span
        className="shrink-0 rounded-full bg-green-500/20 px-2 py-0.5 text-green-300"
        aria-label="Stealth HUD active"
      >
        ● Stealth
      </span>

      <span className="flex-1" />

      {/* Click-through toggle — no-drag so clicks register */}
      <button
        type="button"
        style={{ WebkitAppRegion: "no-drag" }}
        className={`rounded px-2 py-1 text-[11px] transition-colors ${
          state.clickThrough
            ? "bg-amber-500/30 text-amber-200"
            : "bg-white/10 text-gray-300 hover:bg-white/20"
        }`}
        title={
          state.clickThrough
            ? "Click-through ON — clicks pass to window below (⌘⇧M)"
            : "Click-through OFF — HUD captures clicks (⌘⇧M)"
        }
        onClick={() => void toggleClickThrough()}
        aria-pressed={state.clickThrough}
      >
        {state.clickThrough ? "Click-thru ON" : "Click-thru OFF"}
      </button>

      {/* Hide HUD (keyboard shortcut ⌘⇧H also works) */}
      <button
        type="button"
        style={{ WebkitAppRegion: "no-drag" }}
        className="rounded px-2 py-1 text-[11px] text-gray-300 hover:bg-white/20 transition-colors"
        title="Hide HUD (⌘⇧H to show again)"
        onClick={() => {
          // The main process handles toggling via the global shortcut;
          // hiding from the renderer side sends focus back to the meeting app.
          void window.interviewMeetDesktop?.stealth?.setClickThrough(true).then(() =>
            window.interviewMeetDesktop?.stealth?.setClickThrough(false),
          );
        }}
        aria-label="Temporarily hide HUD"
      >
        Hide
      </button>

      {/* Exit stealth / end session */}
      <button
        type="button"
        style={{ WebkitAppRegion: "no-drag" }}
        className="rounded px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/20 transition-colors"
        title="Exit stealth and return to full app"
        onClick={() => {
          void exit();
          onEnd?.();
        }}
      >
        Exit Stealth
      </button>
    </div>
  );
}
