import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopSyncPanel } from "./DesktopSyncPanel";

describe("DesktopSyncPanel", () => {
  const origFetch = window.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.fetch = origFetch;
  });

  it("renders the PIN and handles copying", async () => {
    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        session_id: "sid-123",
        pin: "123456",
        formatted_pin: "123-456",
        connected_clients: 1,
      }),
      headers: new Headers(),
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<DesktopSyncPanel sessionId="sid-123" ended={false} />);

    const getPinBtn = screen.getByRole("button", {
      name: /get desktop sync pin/i,
    });
    await userEvent.click(getPinBtn);

    expect(await screen.findByText("123-456")).toBeInTheDocument();
    expect(screen.getByText(/Connected \(1 active\)/i)).toBeInTheDocument();

    const copyBtn = screen.getByRole("button", {
      name: /copy desktop sync pin/i,
    });
    await userEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith("123-456");
    expect(await screen.findByText("Copied! ✓")).toBeInTheDocument();
  });

  it("returns null when session has ended", () => {
    const { container } = render(
      <DesktopSyncPanel sessionId="sid-123" ended={true} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
