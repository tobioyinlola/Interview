import { useAppUpdate } from "./updates";

/** Shown inside the installed apps when a newer version can be downloaded. */
export function UpdateBanner() {
  const update = useAppUpdate();
  if (!update) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 bg-accent-soft px-4 py-2.5 text-sm text-accent-dark sm:px-6"
    >
      <span>
        A new version of InterviewMeet ({update.version}) is ready to download.
      </span>
      <span className="flex items-center gap-3">
        <a
          href={update.url}
          rel="noopener"
          className="btn-primary !min-h-[36px]"
        >
          Update
        </a>
        <button
          type="button"
          onClick={update.dismiss}
          className="min-h-[44px] px-2 font-medium hover:underline"
        >
          Later
        </button>
      </span>
    </div>
  );
}
