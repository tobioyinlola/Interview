import { PublicShell } from "../ui/PublicShell";

export function BrowserNotice() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-lg px-4 py-12 sm:py-16">
        <div className="card p-6 sm:p-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            This browser isn&apos;t supported
          </h1>
          <p className="mt-3">
            InterviewMeet listens to your Meet tab&apos;s audio, which only
            works in Chrome or Edge on a desktop computer. Please open this page
            there.
          </p>
        </div>
      </main>
    </PublicShell>
  );
}
