import { useEffect } from "react";

import { installerAvailable } from "./appInstaller";
import { isMobileApp } from "./native";
import { PhoneUpdates } from "./PhoneUpdates";
import { notifyUpdate, useAppUpdate } from "./updates";

/** Shown inside the installed apps when a newer version can be downloaded. */
export function UpdateBanner() {
  // an Android app that can install its own update does it all here, without a browser
  if (
    isMobileApp() &&
    window.Capacitor?.getPlatform?.() === "android" &&
    installerAvailable()
  )
    return <PhoneUpdates />;
  return <DownloadBanner />;
}

/** The older way, kept for apps that cannot update themselves: a link to the download. */
function DownloadBanner() {
  const update = useAppUpdate();
  const version = update?.version;
  const url = update?.url;
  useEffect(() => {
    if (!isMobileApp() || !version || !url) return;
    void notifyUpdate(version, url); // a pop-up as well as the banner, once per version
  }, [version, url]);
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
          data-ev="update.accept"
          rel="noopener"
          className="btn-primary !min-h-[36px]"
        >
          Update
        </a>
        <button
          type="button"
          data-ev="update.later"
          onClick={update.dismiss}
          className="min-h-[44px] px-2 font-medium hover:underline"
        >
          Later
        </button>
      </span>
    </div>
  );
}
