import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/inter/wght-italic.css";
import { App } from "./app/App";
import { initFingerprint } from "./api/fingerprint";
import { captureInvite } from "./features/referral/invite";
import "./index.css";

void initFingerprint(); // a coarse device hash, sent with requests so self-invites do not count
captureInvite(); // remember an invite code from the link, before anything navigates away

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
