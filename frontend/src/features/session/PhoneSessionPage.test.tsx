import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PhoneSessionPage } from "./PhoneSessionPage";
import { type LiveState, useLiveStore } from "./store";

const ctl = vi.hoisted(() => ({
  share: vi.fn(),
  end: vi.fn(),
  regenerate: vi.fn(),
  submitManual: vi.fn(),
  markDone: vi.fn(),
  dispose: vi.fn(),
  made: [] as unknown[],
}));
vi.mock("./controller", () => ({
  LiveSessionController: class {
    constructor(d: unknown) {
      ctl.made.push(d);
      return ctl;
    }
  },
}));

const set = (p: Partial<LiveState>) => act(() => useLiveStore.setState(p));
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/session/s1"]}>
      <Routes>
        <Route path="/session/:id" element={<PhoneSessionPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  Object.values(ctl).forEach((f) => typeof f === "function" && f.mockReset());
  ctl.made.length = 0;
  useLiveStore.getState().reset();
  useLiveStore.setState({ blur: false });
});

describe("a live interview on the phone", () => {
  it("listens through the microphone, and only when the person taps Start listening", async () => {
    renderPage();
    expect((ctl.made[0] as { source: string }).source).toBe("mic");
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Ready");
    expect(screen.getByText(/near the speaker of your call/)).toBeVisible();
    expect(ctl.share).not.toHaveBeenCalled(); // never automatic: the microphone asks first
    await userEvent.click(
      screen.getByRole("button", { name: "Start listening" }),
    );
    expect(ctl.share).toHaveBeenCalledTimes(1);
  });

  it("shows what is being heard, then the draft answer, and moves on when done", async () => {
    renderPage();
    set({
      status: "listening",
      level: 0.1,
      lines: [
        {
          key: "a",
          speaker: "partner",
          text: "Tell me about a launch you led.",
        },
      ],
      turnStart: 0,
    });
    expect(screen.getByText("Listening")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Sound level" })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
    expect(screen.getByTestId("question")).toHaveTextContent(
      "Tell me about a launch you led.",
    );
    expect(
      screen.queryByRole("button", { name: "Start listening" }),
    ).toBeNull();
    set({
      outline: {
        question: "Tell me about a launch you led.",
        text: "TYPE: behavioral\nANSWER: At Northwind I led the payments roadmap.\nSOURCES:\n- CV",
        state: "done",
        flags: [],
        revealed: false,
      },
    });
    expect(screen.getByTestId("outline")).toHaveTextContent(
      "At Northwind I led the payments roadmap.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Done, next question" }),
    );
    expect(ctl.markDone).toHaveBeenCalled();
  });

  it("lets a question be typed, without any microphone", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText("Type a question"), "Why us?");
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(ctl.submitManual).toHaveBeenCalledWith("Why us?");
  });

  it("explains a blocked microphone in plain words and offers to try again", async () => {
    renderPage();
    set({
      status: "error",
      problem:
        "Microphone access was blocked. Allow the microphone for this site in the browser, then try again.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Microphone access was blocked/,
    );
    await userEvent.click(screen.getByRole("button", { name: "Listen again" }));
    expect(ctl.share).toHaveBeenCalled();
  });

  it("ends the session and links to the review", async () => {
    renderPage();
    set({ status: "listening" });
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(ctl.end).toHaveBeenCalled();
    set({ status: "ended" });
    expect(screen.getByRole("link", { name: "Review it" })).toHaveAttribute(
      "href",
      "/sessions/s1",
    );
  });

  it("supports switching audio mode and shows dual sound meters in dual mode", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/session/s1", state: { audioMode: "dual" } }]}>
        <Routes>
          <Route path="/session/:id" element={<PhoneSessionPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((ctl.made[0] as { source: string }).source).toBe("dual");

    // Check dual meters when listening
    set({ status: "listening", level: 0.15, micLevel: 0.25 });
    expect(screen.getByRole("meter", { name: "Interviewer sound level" })).toHaveAttribute(
      "aria-valuenow",
      "60",
    );
    expect(screen.getByRole("meter", { name: "Microphone sound level" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });
});
