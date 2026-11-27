import { Component, type ReactNode } from "react";

import { code } from "../analytics/capture";
import { track } from "../analytics/client";

/** The last line of defence. If anything crashes while drawing the page and no feature boundary
 *  caught it, React removes the whole page and leaves a blank window (in the desktop app, a
 *  frameless one you cannot even close). This shows a way out instead. */
export class RootBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Name only: error messages can contain user content.
    console.error("The app crashed", error.name);
    track("ui_error", { kind: code(error.name, "error"), source: "root" });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="max-w-md text-muted">
          The page hit a problem and stopped. Reloading usually fixes it, and
          your work is saved.
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </main>
    );
  }
}
