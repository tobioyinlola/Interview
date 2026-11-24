type Bridge = {
  Plugins?: { SplashScreen?: { hide?: (o?: object) => unknown } };
  nativePromise?: (plugin: string, method: string, o?: object) => unknown;
};

/** The phone app shows its own splash (our logo on the brand colour) the moment the icon is tapped,
 *  and keeps it up until the web app has something to show. Called once the opening animation is on
 *  screen, so the hand-over is seamless and never a blank wait. A shell with no such splash (the
 *  website, the desktop app) ignores it. */
export function hideNativeSplash(): void {
  const cap = (window as { Capacitor?: Bridge }).Capacitor;
  if (!cap) return;
  try {
    const hide = cap.Plugins?.SplashScreen?.hide;
    if (hide)
      void hide.call(cap.Plugins?.SplashScreen, { fadeOutDuration: 150 });
    else
      void cap.nativePromise?.("SplashScreen", "hide", {
        fadeOutDuration: 150,
      });
  } catch {
    /* the splash lifts on its own after a few seconds anyway */
  }
}
