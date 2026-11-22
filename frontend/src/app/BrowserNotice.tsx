import { AuthLayout } from "../ui/AuthLayout";

export function BrowserNotice() {
  return (
    <AuthLayout plain>
      <div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
          This browser isn&apos;t supported
        </h1>
        <p className="mt-3">
          InterviewMeet listens to your Meet tab&apos;s audio, which only works
          in Chrome or Edge on a desktop computer. Please open this page there.
        </p>
      </div>
    </AuthLayout>
  );
}
