import { Link } from "react-router-dom";

import { isNativeApp } from "../app/native";
import { Wordmark } from "../features/landing/Logo";
import { AuthCarousel } from "./AuthCarousel";
import { PublicShell } from "./PublicShell";

/** The frame for the sign-in, sign-up and password pages. On a large screen the form is on the right
 *  and a three-slide showcase of the product is on the left; on a phone or tablet there is only the
 *  form. No box around the form: it sits straight on the page, with room for the notch and the home
 *  bar. `plain` gives the old single column (used for notices that are not about signing in). */
export function AuthLayout({
  children,
  plain = false,
}: {
  children: React.ReactNode;
  plain?: boolean;
}) {
  if (plain)
    return (
      <PublicShell>
        <main className="mx-auto w-full max-w-md px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:pt-12">
          {children}
        </main>
      </PublicShell>
    );
  return (
    <div className="min-h-screen bg-canvas text-ink [min-height:100dvh] lg:grid lg:grid-cols-2">
      <aside
        data-testid="auth-showcase"
        className="relative hidden overflow-hidden bg-ink p-10 lg:block"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-accent/30 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
        />
        <div className="relative flex h-full flex-col gap-6">
          <Link to="/" aria-label="InterviewMeet home" className="text-surface">
            <Wordmark />
          </Link>
          <div className="flex-1">
            <AuthCarousel />
          </div>
        </div>
      </aside>
      <div className="flex min-h-screen flex-col [min-height:100dvh]">
        <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
          <div className="flex items-center justify-between py-2">
            <Link
              to="/"
              aria-label="InterviewMeet home"
              className="lg:invisible"
            >
              <Wordmark />
            </Link>
            {/* an installed app starts at sign-in; there is no website home to go back to */}
            {!isNativeApp() && (
              <Link
                to="/"
                className="inline-flex min-h-[44px] items-center text-sm text-muted hover:text-ink"
              >
                Back to home
              </Link>
            )}
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
