import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { apiFetch } from "../api/client";
import {
  InstallError,
  canInstall,
  downloadUpdate,
  installDownloaded,
  openInstallSettings,
} from "./appInstaller";
import {
  RUNNING_UI,
  applyReadyUi,
  canUpdateInterface,
  needsAppInstall,
  pickUiUpdate,
  prepareUiUpdate,
  readyUi,
  type UiOffer,
} from "./liveUpdate";
import { notifyUpdate } from "./updates";

interface Releases {
  android: {
    version: string;
    url: string;
    sha256?: string | null;
    build?: number | null;
  } | null;
  ui?: UiOffer | null;
}

interface AppPlugin {
  getInfo?: () => Promise<{ build?: string }>;
  addListener?: (
    name: "appStateChange",
    fn: (s: { isActive: boolean }) => void,
  ) => unknown;
}
const phoneApp = (): AppPlugin | undefined =>
  (window.Capacitor as { Plugins?: { App?: AppPlugin } } | undefined)?.Plugins
    ?.App;

type Step =
  | { kind: "idle" }
  | { kind: "allow" } // Android has to be told once that this app may install updates
  | { kind: "downloading"; fraction: number | null }
  | { kind: "ready" }
  | { kind: "reinstall" } // the file is signed with a different key: Android would refuse it
  | { kind: "failed"; message: string };

const FAILURES: Record<string, string> = {
  checksum:
    "The download did not match what we published, so it was thrown away. Try again.",
  network: "The download was interrupted. Check your connection and try again.",
  http: "The download could not be found. Try again in a little while.",
  storage: "There is not enough room on the phone to save the update.",
};

/** The phone app updates itself without leaving the app. A new interface is fetched quietly and
 *  switched to on a restart; a new app version is downloaded here, checked, and handed to Android's
 *  installer (Android asks for one tap to confirm). */
export function PhoneUpdates() {
  const qc = useQueryClient();
  const [build, setBuild] = useState<number | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [hidden, setHidden] = useState(false);
  const [prepared, setPrepared] = useState(0); // bumps when a background download finishes

  useEffect(() => {
    phoneApp()
      ?.getInfo?.()
      .then((i) => setBuild(i.build ? Number(i.build) : null))
      .catch(() => undefined);
    // coming back to the app is a good moment to look again
    void Promise.resolve(
      phoneApp()?.addListener?.("appStateChange", (s) => {
        if (s.isActive)
          void qc.invalidateQueries({ queryKey: ["app-releases"] });
      }),
    );
  }, [qc]);

  const releases = useQuery<Releases>({
    queryKey: ["app-releases"],
    queryFn: () => apiFetch<Releases>("/api/app/releases"),
    enabled: build !== null,
    staleTime: 30 * 60_000,
    refetchInterval: 6 * 60 * 60_000,
    retry: false,
  });

  const ui = pickUiUpdate(releases.data?.ui, RUNNING_UI, build);
  const uiKey = ui?.version;
  useEffect(() => {
    if (!ui || !canUpdateInterface() || readyUi()) return;
    void prepareUiUpdate(ui).then((ok) => ok && setPrepared((n) => n + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiKey]);

  const android = releases.data?.android ?? null;
  const appNeeded =
    !!android &&
    needsAppInstall(android, releases.data?.ui, build, canUpdateInterface());

  const popped = useRef(false);
  useEffect(() => {
    if (!appNeeded || !android || popped.current) return;
    popped.current = true;
    void notifyUpdate(android.version, android.url); // a pop-up as well, once per version
  }, [appNeeded, android]);

  // after the person allows installs and comes back, carry on
  useEffect(() => {
    if (step.kind !== "allow") return;
    const again = () => {
      if (document.visibilityState === "visible")
        void canInstall().then((ok) => ok && setStep({ kind: "ready" }));
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [step.kind]);

  const waiting = readyUi();
  void prepared;

  const start = async () => {
    if (!android?.sha256) {
      setStep({
        kind: "failed",
        message: "This update cannot be checked, so it was not installed.",
      });
      return;
    }
    setStep({ kind: "downloading", fraction: null });
    try {
      const { sameSigner } = await downloadUpdate(
        android.url,
        android.sha256,
        (f) => setStep({ kind: "downloading", fraction: f }),
      );
      if (!sameSigner) return setStep({ kind: "reinstall" });
      if (!(await canInstall())) return setStep({ kind: "allow" });
      setStep({ kind: "ready" });
      await installNow();
    } catch (e) {
      const r = e instanceof InstallError ? e.reason : "unknown";
      setStep({
        kind: "failed",
        message:
          FAILURES[r] ?? "The update could not be downloaded. Try again.",
      });
    }
  };

  const installNow = async () => {
    try {
      await installDownloaded();
    } catch (e) {
      if (e instanceof InstallError && e.reason === "permission")
        setStep({ kind: "allow" });
      else
        setStep({
          kind: "failed",
          message: "Android could not start the installer. Try again.",
        });
    }
  };

  if (hidden) return null;
  const bar =
    "flex flex-wrap items-center justify-between gap-2 bg-accent-soft px-4 py-2.5 text-sm text-accent-dark";

  if (waiting && step.kind === "idle")
    return (
      <div role="status" className={bar}>
        <span>
          InterviewMeet {waiting.version} is ready. Restart to finish updating.
        </span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            className="btn-primary !min-h-[36px]"
            onClick={() => void applyReadyUi()}
          >
            Restart
          </button>
          <button
            type="button"
            className="min-h-[44px] px-2 font-medium hover:underline"
            onClick={() => setHidden(true)}
          >
            Later
          </button>
        </span>
      </div>
    );

  if (!appNeeded || !android) return null;

  const later = (
    <button
      type="button"
      className="min-h-[44px] px-2 font-medium hover:underline"
      onClick={() => setHidden(true)}
    >
      Later
    </button>
  );
  return (
    <div role="status" className={bar}>
      {step.kind === "idle" && (
        <>
          <span>
            A new version of InterviewMeet ({android.version}) is ready.
          </span>
          <span className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary !min-h-[36px]"
              onClick={() => void start()}
            >
              Update
            </button>
            {later}
          </span>
        </>
      )}
      {step.kind === "downloading" && (
        <span aria-live="polite">
          Downloading the update
          {step.fraction !== null
            ? ` ${Math.round(step.fraction * 100)}%`
            : "…"}
        </span>
      )}
      {step.kind === "allow" && (
        <>
          <span>
            Allow InterviewMeet to install updates, then come back here.
          </span>
          <button
            type="button"
            className="btn-primary !min-h-[36px]"
            onClick={() => void openInstallSettings()}
          >
            Open settings
          </button>
        </>
      )}
      {step.kind === "ready" && (
        <>
          <span>
            Ready. Tap Install and confirm in the screen Android shows.
          </span>
          <button
            type="button"
            className="btn-primary !min-h-[36px]"
            onClick={() => void installNow()}
          >
            Install
          </button>
        </>
      )}
      {step.kind === "reinstall" && (
        <>
          <span>
            This update is signed with a different key, so Android will not
            install it over the current app. Delete the app once and install the
            new one; after that, updates will install here.
          </span>
          <a
            href={android.url}
            rel="noopener"
            className="btn-primary !min-h-[36px]"
          >
            Download
          </a>
        </>
      )}
      {step.kind === "failed" && (
        <>
          <span role="alert">{step.message}</span>
          <button
            type="button"
            className="btn-primary !min-h-[36px]"
            onClick={() => void start()}
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
