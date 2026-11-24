import type { CapacitorConfig } from "@capacitor/cli";

// The app carries its own copy of the interface (built from ../frontend by `npm run build:web` into
// www/), so it opens instantly and works with no internet. It talks to the API over https; which
// site that is gets decided when the interface is built (INTERVIEWMEET_URL, see
// ../scripts/build-app-ui.js). The page runs from https://localhost on Android and
// capacitor://localhost on iPhone: the API accepts both (APP_ORIGINS).
const config: CapacitorConfig = {
  appId: "com.interviewmeet.app",
  appName: "InterviewMeet",
  webDir: "www",
  server: {
    androidScheme: "https",
    cleartext: false,
  },
  ios: { contentInset: "automatic", backgroundColor: "#1c1b2e" },
  android: {
    backgroundColor: "#1c1b2e",
    allowMixedContent: false,
    // Android 15 and later draw apps edge to edge, which put the page under the clock and network
    // icons. This keeps the page below the status bar and above the navigation bar on every phone.
    adjustMarginsForEdgeToEdge: "force",
  },
  plugins: {
    // The splash stays until the interface says its first frame is up (see hideNativeSplash), so
    // there is no blank wait. If anything goes wrong it lifts by itself after a few seconds.
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 6000,
      launchFadeOutDuration: 150,
      backgroundColor: "#1c1b2e",
      showSpinner: false,
    },
    // "LIGHT" means dark icons and text, for a light page. ("DARK" is the other way round, which made
    // the clock and network icons invisible on our light pages.)
    StatusBar: { style: "LIGHT", backgroundColor: "#f7f4ff", overlaysWebView: false },
    // New copies of the interface are fetched by our own code (frontend/src/app/liveUpdate.ts) from
    // this project's releases and switched to only when they start cleanly, otherwise the app goes
    // back to the last good copy. Everything that would talk to the plugin maker's cloud is off.
    CapacitorUpdater: {
      autoUpdate: false,
      updateUrl: "",
      statsUrl: "",
      channelUrl: "",
      appReadyTimeout: 20000,
      resetWhenUpdate: true,
    },
  },
};

export default config;
