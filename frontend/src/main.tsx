import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/inter/wght-italic.css";
import { App } from "./app/App";
import { initFingerprint } from "./api/fingerprint";
import { persistCache, restoreCache } from "./api/persist";
import { APP_SHELL, loadSession } from "./api/session";
import { captureInvite } from "./features/referral/invite";
import { RootBoundary } from "./ui/RootBoundary";
import "./index.css";

void initFingerprint(); // a coarse device hash, sent with requests so self-invites do not count
captureInvite(); // remember an invite code from the link, before anything navigates away

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // In the apps, try the network but never hold the screen: with no internet the last saved
      // content is shown and the request fails quickly, instead of waiting forever.
      ...(APP_SHELL ? { networkMode: "offlineFirst" as const } : {}),
    },
    mutations: APP_SHELL ? { networkMode: "always" as const } : {},
  },
});

async function start() {
  await loadSession(); // a returning person is already signed in on the first frame
  restoreCache(queryClient); // and sees what they saw last, even offline
  persistCache(queryClient);
  render();
}

function render() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RootBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </RootBoundary>
    </StrictMode>,
  );
}

void start();
