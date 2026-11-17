import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

type Handler = (req: { body: unknown; headers: Headers }) => {
  status?: number;
  json?: unknown;
};

/** Routes "METHOD /path" to handlers and records every call. Unmatched calls fail the test. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown; headers: Headers }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const key = `${(init.method ?? "GET").toUpperCase()} ${path}`;
      const headers = new Headers(init.headers);
      // JSON bodies are parsed for the handler; a file body (a CV upload) is passed through as is
      const body =
        typeof init.body === "string"
          ? JSON.parse(init.body)
          : (init.body ?? undefined);
      calls.push({ key, body, headers });
      const h = routes[key];
      if (!h) throw new Error(`Unmocked request: ${key}`);
      const { status = 200, json = {} } = h({ body, headers });
      return new Response(JSON.stringify(json), { status });
    }),
  );
  return calls;
}

export const ME = { id: "u1", email: "me@example.com" };
export const UNAUTH = {
  status: 401,
  json: { error: { code: "not_authenticated", message: "x", request_id: "r" } },
};

export function renderApp(ui: ReactElement, route = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Pretend to be desktop Chrome with tab capture so the browser gate lets the app render. */
export function stubSupportedBrowser() {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
  );
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getDisplayMedia: () => Promise.resolve() },
    configurable: true,
  });
}
