import { PublicShell } from "./PublicShell";

/** The frame for every form page outside the app. No box around the form: it sits straight on the
 *  page, full width on a phone, with room for the notch and the home bar. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <PublicShell>
      <main className="mx-auto w-full max-w-md px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-6 sm:px-6 sm:pt-12">
        {children}
      </main>
    </PublicShell>
  );
}
