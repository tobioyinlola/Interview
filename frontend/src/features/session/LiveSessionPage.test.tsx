import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { LiveSessionPage } from "./LiveSessionPage";
import { type LiveState, type Outline, useLiveStore } from "./store";

const ctl = vi.hoisted(() => ({
  share: vi.fn(),
  end: vi.fn(),
  regenerate: vi.fn(),
  submitManual: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./controller", () => ({
  LiveSessionController: class {
    constructor() {
      return ctl;
    }
  },
}));

const outline = (over: Partial<Outline> = {}): Outline => ({
  question: "Why do you want to work here?",
  text: "TYPE: motivation\nANSWER: Acme sells point-of-sale software and I led a launch.\nSOURCES:\n- Acme sells POS [brief: Acme blog]",
  state: "done",
  flags: [],
  revealed: false,
  ...over,
});
const set = (p: Partial<LiveState>) => act(() => useLiveStore.setState(p));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/session/s1"]}>
      <Routes>
        <Route path="/session/:id" element={<LiveSessionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(ctl).forEach((f) => f.mockReset());
  useLiveStore.getState().reset();
  useLiveStore.setState({ blur: false });
});

describe("LiveSessionPage", () => {
  it("starts idle with the share instructions, and shares only when asked", async () => {
    renderPage();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      "Not started",
    );
    expect(screen.getByText(/Also share tab audio/)).toBeInTheDocument();
    expect(ctl.share).not.toHaveBeenCalled(); // never automatic: the picker needs a click
    await userEvent.click(
      screen.getByRole("button", { name: "Share Meet tab" }),
    );
    expect(ctl.share).toHaveBeenCalledTimes(1);
  });

  it("shows Listening with a level meter, and hides the share button while running", () => {
    renderPage();
    set({ status: "listening", level: 0.1 });
    expect(screen.getByText("Listening")).toBeInTheDocument();
    expect(
      screen.getByRole("meter", { name: "Tab audio level" }),
    ).toHaveAttribute("aria-valuenow", "40");
    expect(screen.queryByRole("button", { name: "Share Meet tab" })).toBeNull();
  });

  it("shows a plain problem with the next step, and lets the user try again", async () => {
    renderPage();
    set({
      status: "error",
      problem:
        'No audio was shared. Tick "Also share tab audio", then try again.',
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Also share tab audio/);
    await userEvent.click(
      screen.getByRole("button", { name: "Share Meet tab" }),
    );
    expect(ctl.share).toHaveBeenCalled();
  });

  it("shows passing notices without hiding the rest", () => {
    renderPage();
    set({
      status: "listening",
      notice: "No sound from the Meet tab for 10 s.",
    });
    expect(screen.getByText(/No sound from the Meet tab/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing heard yet/)).toBeInTheDocument();
  });

  it("explains the empty panel, then shows only the question that was asked and the answer", () => {
    renderPage();
    expect(
      screen.getByText(/Listening for the interviewer's question/),
    ).toBeInTheDocument();
    set({ outline: outline({ firstWordsMs: 2400 }) });
    expect(screen.getByTestId("question")).toHaveTextContent(
      "Why do you want to work here?",
    );
    const answer = screen.getByTestId("outline");
    expect(answer).toHaveTextContent(
      "Acme sells point-of-sale software and I led a launch.",
    );
    // none of the model's scaffolding reaches the panel
    const panel = screen.getByRole("region", { name: "Question and answer" });
    expect(panel).not.toHaveTextContent(/TYPE|SOURCES|\[brief|Acme blog/);
    expect(screen.getByText("First words in 2.4 s")).toBeInTheDocument();
    // the timing and the options sit outside the panel
    expect(panel).not.toHaveTextContent(/First words/);
    expect(
      within(panel).queryByRole("button", { name: "Regenerate" }),
    ).toBeNull();
    expect(within(panel).queryByRole("checkbox")).toBeNull();
  });

  it("shows the question live, word by word, while it is being asked", () => {
    renderPage();
    set({
      lines: [{ key: "a", speaker: "partner", text: "So tell me," }],
      partial: "about a time you",
    });
    expect(screen.getByTestId("question")).toHaveTextContent(
      "So tell me, about a time you…",
    );
    // once the answer exists the question is the one that was asked, frozen
    set({
      outline: outline({ question: "So tell me about a time you led." }),
    });
    expect(screen.getByTestId("question")).toHaveTextContent(
      "So tell me about a time you led.",
    );
  });

  it("lists what the interviewer says after the question without touching the answer", () => {
    renderPage();
    set({
      lines: [
        { key: "a", speaker: "partner", text: "Why do you want to work here?" },
        {
          key: "b",
          speaker: "partner",
          text: "Really focus on the data side.",
        },
      ],
      lockedAt: 1,
      partial: "and the team",
      outline: outline({ question: "Why do you want to work here?" }),
    });
    const extra = screen.getByTestId("additions");
    expect(extra).toHaveTextContent("The interviewer also said");
    expect(extra).toHaveTextContent("Really focus on the data side.");
    expect(extra).toHaveTextContent("and the team…");
    expect(extra).not.toHaveTextContent("Why do you want to work here?");
    expect(screen.getByTestId("outline")).toHaveTextContent(
      "Acme sells point-of-sale software and I led a launch.",
    );
  });

  it("has no additions box when nothing was said after the question", () => {
    renderPage();
    set({
      lines: [{ key: "a", speaker: "partner", text: "Why us?" }],
      lockedAt: 1,
      outline: outline(),
    });
    expect(screen.queryByTestId("additions")).toBeNull();
  });

  it("offers Done, next question, which says the answer stays until it is pressed", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: /Done/ })).toBeNull();
    set({ outline: outline() });
    expect(
      screen.getByRole("button", { name: "Done, next question" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This answer stays until you press Done."),
    ).toBeInTheDocument();
  });

  it("streams the answer without ever showing the part after it", () => {
    renderPage();
    set({
      outline: outline({
        state: "streaming",
        text: "TYPE: motivation\nANSWER: Acme sells software.\nSOU",
      }),
    });
    expect(screen.getByTestId("outline")).toHaveTextContent(
      /^Acme sells software\.$/,
    );
  });

  it("shows Thinking while an outline has no text yet, and is a polite, busy live region", () => {
    renderPage();
    set({ outline: outline({ text: "", state: "streaming" }) });
    const box = screen.getByTestId("outline");
    expect(box).toHaveTextContent("Thinking…");
    expect(box).toHaveAttribute("aria-live", "polite");
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull(); // not while streaming
    set({ outline: outline({ state: "done" }) });
    expect(box).toHaveAttribute("aria-busy", "false");
  });

  it("blur mode hides each new outline until clicked or revealed", async () => {
    renderPage();
    set({ blur: true, outline: outline() });
    const box = screen.getByTestId("outline");
    expect(box.className).toMatch(/blur-sm/);
    await userEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(box.className).not.toMatch(/blur-sm/);
    // a new outline is blurred again
    set({ outline: outline({ question: "Next?", revealed: false }) });
    expect(screen.getByTestId("outline").className).toMatch(/blur-sm/);
    await userEvent.click(screen.getByTestId("outline")); // clicking the outline also reveals
    expect(screen.getByTestId("outline").className).not.toMatch(/blur-sm/);
  });

  it("toggling answer-first mode is remembered", async () => {
    renderPage();
    set({ outline: outline() });
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Answer-first/ }),
    );
    expect(useLiveStore.getState().blur).toBe(true);
    expect(localStorage.getItem("meet-practice-blur")).toBe("1");
  });

  it("an error outline is never blurred and offers a retry", async () => {
    renderPage();
    set({
      blur: true,
      outline: outline({
        text: "",
        state: "error",
        error: {
          code: "answer_unavailable",
          message: "The answer couldn't be written.",
          next_step: "Ask again.",
        },
      }),
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The answer couldn't be written. Ask again.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(ctl.regenerate).toHaveBeenCalled();
  });

  it("warns about points that may not come from the CV", () => {
    renderPage();
    set({ outline: outline({ flags: ["Cut onboarding time by 45%"] }) });
    expect(screen.getByText(/They may not be in your CV/)).toBeInTheDocument();
    expect(screen.getByText("Cut onboarding time by 45%")).toBeInTheDocument();
  });

  it("lists the transcript with the live partial and gap markers", () => {
    renderPage();
    set({
      lines: [
        { key: "1", speaker: "partner", text: "Tell me about yourself." },
        { key: "2", speaker: "gap", text: "[connection lost for about 3 s]" },
        { key: "3", speaker: "typed", text: "Why us?" },
      ],
      partial: "And then",
    });
    const t = screen.getByRole("region", { name: "Transcript" });
    expect(within(t).getByText(/Tell me about yourself/)).toBeInTheDocument();
    expect(
      within(t).getByText("[connection lost for about 3 s]"),
    ).toBeInTheDocument();
    expect(within(t).getByText("Typed:")).toBeInTheDocument();
    expect(within(t).getByText(/And then/)).toBeInTheDocument();
  });

  it("submits a typed question with Enter and clears the box", async () => {
    renderPage();
    const box = screen.getByLabelText("Type a question");
    await userEvent.type(box, "What is your biggest weakness?{Enter}");
    expect(ctl.submitManual).toHaveBeenCalledWith(
      "What is your biggest weakness?",
    );
    expect(box).toHaveValue("");
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("ending the session offers the transcript and the review", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(ctl.end).toHaveBeenCalled();
    set({ status: "ended" });
    expect(screen.getByRole("link", { name: "Review it" })).toHaveAttribute(
      "href",
      "/sessions/s1",
    );
    expect(
      screen
        .getByRole("link", { name: "Download transcript" })
        .getAttribute("href"),
    ).toMatch(/\/api\/sessions\/s1\/transcript\.txt$/);
    expect(screen.queryByLabelText("Type a question")).toBeNull();
  });

  it("leaving the page stops capture", () => {
    const { unmount } = renderPage();
    unmount();
    expect(ctl.dispose).toHaveBeenCalled();
  });
});
