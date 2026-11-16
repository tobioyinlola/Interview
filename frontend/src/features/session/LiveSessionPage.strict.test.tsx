/** Regression: under React StrictMode (always on in development) the page's cleanup runs before
 *  its setup. With the REAL controller, Share must still start capture. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { LiveSessionPage } from "./LiveSessionPage";
import { useLiveStore } from "./store";

const mocks = vi.hoisted(() => ({
  startTabCapture: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../../audio/captureTab", async (orig) => ({
  ...(await orig<typeof import("../../audio/captureTab")>()),
  startTabCapture: mocks.startTabCapture,
}));
vi.mock("../../audio/AudioSocket", () => ({
  AudioSocket: class {
    start = mocks.start;
    stop = vi.fn();
    sendAudio = vi.fn();
  },
}));

beforeEach(() => {
  useLiveStore.getState().reset();
  mocks.startTabCapture.mockReset().mockResolvedValue({ stop: vi.fn() });
  mocks.start.mockReset();
});

it("Share Meet tab starts capture and opens the socket under StrictMode", async () => {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={["/session/s1"]}>
        <Routes>
          <Route path="/session/:id" element={<LiveSessionPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Share Meet tab" }));
  expect(mocks.startTabCapture).toHaveBeenCalledTimes(1);
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(useLiveStore.getState().status).toBe("starting");
});
