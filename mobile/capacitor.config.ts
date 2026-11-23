import type { CapacitorConfig } from "@capacitor/cli";

// The app shows the live site, so every feature and fix reaches phones with the website, and the
// login cookie stays first-party. Change the address for a build with INTERVIEWMEET_URL.
const DEFAULT_URL = "https://frontend-dev-2d437f97.up.railway.app";
const url = new URL(process.env.INTERVIEWMEET_URL || DEFAULT_URL);
if (url.protocol !== "https:" && url.hostname !== "localhost") {
  throw new Error("INTERVIEWMEET_URL must be https");
}

const config: CapacitorConfig = {
  appId: "com.interviewmeet.app",
  appName: "InterviewMeet",
  webDir: "www", // only the offline page; the app itself is loaded from `server.url`
  server: {
    url: url.origin,
    cleartext: url.protocol === "http:",
    // Only the app's own address stays inside the app. Any other link opens in the phone's browser.
    allowNavigation: [url.hostname],
  },
  ios: { contentInset: "automatic", backgroundColor: "#1c1b2e" },
  android: { backgroundColor: "#1c1b2e", allowMixedContent: false },
  plugins: {
    SplashScreen: { launchAutoHide: true, backgroundColor: "#1c1b2e", showSpinner: false },
    StatusBar: { style: "DARK", backgroundColor: "#f7f4ff" },
  },
};

export default config;
