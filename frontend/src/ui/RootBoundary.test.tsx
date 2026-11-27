import { render, screen } from "@testing-library/react";

import { RootBoundary } from "./RootBoundary";

function Boom(): never {
  throw new Error("boom");
}

describe("RootBoundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a way out instead of a blank window when the page crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RootBoundary>
        <Boom />
      </RootBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("renders the page normally when nothing is wrong", () => {
    render(
      <RootBoundary>
        <p>all good</p>
      </RootBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });
});
