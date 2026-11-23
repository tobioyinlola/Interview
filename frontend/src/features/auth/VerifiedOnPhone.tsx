import { ANDROID_DOWNLOAD_URL } from "../landing/LandingPage";

const onAndroid = () => /Android/i.test(navigator.userAgent);

/** What a phone's browser shows after an emailed link was used: the account is ready, and the
 *  place to carry on is the app. */
export function VerifiedOnPhone({
  title,
  line,
  link,
}: {
  title: string;
  line: string;
  /** The one-time hand-back to the app, when there is one; otherwise just open the app. */
  link?: string;
}) {
  return (
    <div>
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">
        {title}
      </h1>
      <p className="mt-2">{line}</p>
      <a
        href={link ?? "interviewmeet://auth"}
        className="btn-primary btn-lg mt-4"
      >
        Open InterviewMeet
      </a>
      {onAndroid() && (
        <p className="mt-4 text-sm text-muted">
          App not installed yet?{" "}
          <a
            href={ANDROID_DOWNLOAD_URL}
            rel="noopener"
            className="font-medium text-accent-dark underline"
          >
            Download it for Android
          </a>
          , open it and sign in with your email.
        </p>
      )}
    </div>
  );
}
