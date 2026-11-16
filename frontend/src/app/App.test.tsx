import { screen } from "@testing-library/react";

import { renderApp } from "../test-utils";
import { App } from "./App";

describe("App", () => {
  it("shows the not-supported page for app routes outside desktop Chromium", () => {
    // jsdom has no getDisplayMedia, so the gate must trigger before any server call.
    renderApp(<App />, "/dashboard");
    expect(screen.getByText(/isn't supported/i)).toBeInTheDocument();
  });

  it("still shows the landing and legal pages in any browser", () => {
    renderApp(<App />, "/terms");
    expect(screen.queryByText(/isn't supported/i)).not.toBeInTheDocument();
  });
});
