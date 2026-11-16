import { screen } from "@testing-library/react";

import { renderApp } from "../test-utils";
import { App } from "./App";

describe("App", () => {
  it("shows the not-supported page outside desktop Chromium", () => {
    // jsdom has no getDisplayMedia, so the gate must trigger before any server call.
    renderApp(<App />);
    expect(screen.getByText(/isn't supported/i)).toBeInTheDocument();
  });
});
