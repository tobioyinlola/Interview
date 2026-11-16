import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { FeatureBoundary } from "./FeatureBoundary";

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error("secret content in message");
  return <p>recovered</p>;
}

describe("FeatureBoundary", () => {
  it("contains a crash to its own feature, leaves siblings working, and can retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    shouldThrow = true;
    function Page() {
      const [n] = useState(0);
      return (
        <>
          <p>answer panel {n}</p>
          <FeatureBoundary name="transcript">
            <Bomb />
          </FeatureBoundary>
        </>
      );
    }
    render(<Page />);
    expect(screen.getByText("answer panel 0")).toBeInTheDocument(); // sibling untouched
    expect(screen.getByRole("alert")).toHaveTextContent(
      /The transcript had a problem/,
    );
    expect(screen.queryByText(/secret content/)).toBeNull(); // the error text is never shown

    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("recovered")).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
