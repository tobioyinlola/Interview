import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { LiveSessionController } from "./controller";
import { StealthTerminalHud } from "./StealthTerminalHud";
import { type LiveState, useLiveStore } from "./store";

const share = vi.fn();
const controller = {
  share,
  markDone: vi.fn(),
  regenerate: vi.fn(),
} as unknown as LiveSessionController;

const set = (p: Partial<LiveState>) => act(() => useLiveStore.setState(p));
const renderHud = () =>
  render(
    <StealthTerminalHud
      controller={controller}
      onEnd={() => undefined}
      onExitStealth={() => undefined}
    />,
  );

beforeEach(() => {
  share.mockReset();
  useLiveStore.getState().reset();
});

// The HUD used to say "Listening for interviewer questions" whatever was happening, even when
// capture had never started or had failed, so a dead session looked alive.
describe("floating HUD: what it says about listening", () => {
  it("says it is not listening, and offers to start, when nothing has started", async () => {
    renderHud();
    expect(screen.queryByText(/Listening for interviewer questions/)).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Start listening" }),
    );
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("shows the reason capture failed and lets the person try again", async () => {
    renderHud();
    set({ status: "error", problem: "The browser couldn't start audio capture." });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The browser couldn't start audio capture.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Start listening" }),
    );
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("offers to start again after listening stopped", () => {
    renderHud();
    set({ status: "stopped", problem: "Sharing stopped." });
    expect(
      screen.getByRole("button", { name: "Start listening" }),
    ).toBeInTheDocument();
  });

  it("says it is starting, with no button, while capture is starting", () => {
    renderHud();
    set({ status: "starting" });
    expect(screen.getByText(/Starting/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start listening" })).toBeNull();
  });

  it("says it is listening only once it really is, and shows passing notices", () => {
    renderHud();
    set({ status: "listening", notice: "No sound heard for 10 s." });
    expect(
      screen.getByText(/Listening for interviewer questions/),
    ).toBeInTheDocument();
    expect(screen.getByText("No sound heard for 10 s.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start listening" })).toBeNull();
  });
});
