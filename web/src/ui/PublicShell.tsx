import { Link } from "react-router-dom";

import { Wordmark } from "../features/landing/Logo";

/** Frame for pages outside the signed-in app: sign-in, link check, legal, unsupported browser. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="px-4 pt-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-0 py-3">
          <Link to="/" aria-label="InterviewMeet home">
            <Wordmark />
          </Link>
          <Link to="/" className="text-sm text-muted hover:text-ink">
            Back to home
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
