import { ANDROID_DOWNLOAD_URL } from "../features/landing/LandingPage";
import { AuthLayout } from "../ui/AuthLayout";

const onAndroid = (ua = navigator.userAgent) => /Android/i.test(ua);
const onIphone = (ua = navigator.userAgent) => /iPhone|iPad|iPod/i.test(ua);

/** Shown in a browser that cannot do what the live interview needs. On a phone the answer is the
 *  app, not a different browser. */
export function BrowserNotice() {
  const android = onAndroid();
  return (
    <AuthLayout plain>
      <div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
          {android || onIphone()
            ? "Use the InterviewMeet app"
            : "This browser isn't supported"}
        </h1>
        {android ? (
          <>
            <p className="mt-3">
              On a phone, InterviewMeet works as an app. Download it, open it
              and sign in there.
            </p>
            <a
              href={ANDROID_DOWNLOAD_URL}
              rel="noopener"
              className="btn-primary btn-lg mt-4"
            >
              Download for Android
            </a>
          </>
        ) : onIphone() ? (
          <p className="mt-3">
            The iPhone app is coming. For now, open InterviewMeet in Chrome or
            Edge on a computer, or use the Android app.
          </p>
        ) : (
          <p className="mt-3">
            InterviewMeet listens to your Meet tab&apos;s audio, which only
            works in Chrome or Edge on a desktop computer. Please open this page
            there.
          </p>
        )}
      </div>
    </AuthLayout>
  );
}
