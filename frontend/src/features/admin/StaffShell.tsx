import type { ReactNode } from "react";

import { LogoMark } from "../landing/Logo";

/** The plain frame for the back office's own pages (sign-in, link check). It looks different from
 *  the customer app on purpose, so nobody mistakes one for the other. */
export function StaffShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-surface [min-height:100dvh] lg:grid lg:grid-cols-2">
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden bg-gradient-to-br from-ink via-ink to-accent-dark p-12 lg:flex lg:flex-col lg:justify-between"
      >
        <div className="flex items-center gap-3">
          <LogoMark />
          <p className="text-lg font-semibold">InterviewMeet</p>
        </div>
        <div className="max-w-md">
          <p className="text-4xl font-semibold leading-tight tracking-tight">
            Everything about the product, in one calm place.
          </p>
          <p className="mt-4 text-surface/70">
            People, activity, outreach and cost. You see what happened, never
            what anyone said.
          </p>
        </div>
        <p className="text-xs uppercase tracking-widest text-surface/50">
          InterviewMeet team
        </p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/30 blur-3xl" />
      </aside>
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10 [min-height:100dvh] sm:px-6 lg:max-w-lg">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <LogoMark />
          <div>
            <p className="text-lg font-semibold leading-tight">InterviewMeet</p>
            <p className="text-xs uppercase tracking-widest text-surface/70">
              Back office · staff only
            </p>
          </div>
        </div>
        <div className="rounded-3xl bg-surface p-6 text-ink shadow-xl sm:p-8">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-surface/60">
          This area is for the InterviewMeet team. Customers sign in{" "}
          <a href="/login" className="underline">
            here
          </a>
          .
        </p>
      </main>
    </div>
  );
}
