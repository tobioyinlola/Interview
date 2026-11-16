import { Link } from "react-router-dom";

import { Wordmark } from "../features/landing/Logo";

/** Frame for pages outside the signed-in app: sign-in, link check, legal, unsupported browser. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink [min-height:100dvh]">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between py-2">
          <Link to="/" aria-label="InterviewMeet home">
            <Wordmark />
          </Link>
          <Link
            to="/"
            className="inline-flex min-h-[44px] items-center text-sm text-muted hover:text-ink"
          >
            Back to home
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
