import { isDesktopApp, minimizeDesktopWindow, maximizeDesktopWindow, closeDesktopWindow } from "./desktop";
import { LogoMark } from "../features/landing/Logo";

/** Sleek top window title bar for the frameless Electron desktop app in normal mode. */
export function DesktopTitleBar() {
  if (!isDesktopApp()) return null;

  return (
    <header
      className="flex h-8 w-full select-none items-center justify-between bg-ink px-3 text-surface text-xs"
      style={{ WebkitAppRegion: "drag" as React.CSSProperties["WebkitAppRegion"] }}
    >
      <div className="flex items-center gap-2">
        <LogoMark className="h-4 w-4" />
        <span className="font-medium text-surface/80">InterviewMeet</span>
      </div>

      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: "no-drag" as React.CSSProperties["WebkitAppRegion"] }}
      >
        <button
          type="button"
          onClick={minimizeDesktopWindow}
          aria-label="Minimize"
          className="flex h-6 w-8 items-center justify-center rounded text-surface/70 hover:bg-surface/10 hover:text-surface transition-colors"
        >
          <span className="text-sm font-semibold leading-none">─</span>
        </button>
        <button
          type="button"
          onClick={maximizeDesktopWindow}
          aria-label="Maximize"
          className="flex h-6 w-8 items-center justify-center rounded text-surface/70 hover:bg-surface/10 hover:text-surface transition-colors"
        >
          <span className="text-xs leading-none">□</span>
        </button>
        <button
          type="button"
          onClick={closeDesktopWindow}
          aria-label="Close"
          className="flex h-6 w-8 items-center justify-center rounded text-surface/70 hover:bg-red-600 hover:text-white transition-colors"
        >
          <span className="text-xs font-semibold leading-none">✕</span>
        </button>
      </div>
    </header>
  );
}
