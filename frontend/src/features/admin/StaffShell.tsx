import type { ReactNode } from "react";

import { LogoMark } from "../landing/Logo";

/** The plain frame for the back office's own pages (sign-in, link check). It looks different from
 *  the customer app on purpose, so nobody mistakes one for the other. */
export function StaffShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink text-surface [min-height:100dvh]">
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10 [min-height:100dvh] sm:px-6">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark />
          <div>
            <p className="text-lg font-semibold leading-tight">InterviewMeet</p>
            <p className="text-xs uppercase tracking-widest text-surface/70">
              Back office · staff only
            </p>
          </div>
        </div>
        <div className="rounded-2xl bg-surface p-6 text-ink shadow-xl sm:p-8">
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
