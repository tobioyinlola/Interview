import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { mockApi } from "../../test-utils";
import { LiveSessionPage } from "./LiveSessionPage";
import { type LiveState, type Outline, useLiveStore } from "./store";

const ctl = vi.hoisted(() => ({
  share: vi.fn(),
  end: vi.fn(),
  regenerate: vi.fn(),
  submitManual: vi.fn(),
  setMic: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./controller", () => ({
  LiveSessionController: class {
    constructor() {
      return ctl;
    }
  },
}));

const set = (p: Partial<LiveState>) => act(() => useLiveStore.setState(p));
const outline = (over: Partial<Outline> = {}): Outline => ({
  question: "Why us?",
  text: "TYPE: company\nANSWER: Acme sells point-of-sale software.\nSOURCES:\n- Acme sells POS [brief: Acme site]",
  state: "done",
  suggestionId: "sg1",
  flags: [],
  revealed: false,
  ...over,
});
const page = () =>
  render(
    <MemoryRouter initialEntries={["/session/s1"]}>
      <Routes>
        <Route path="/session/:id" element={<LiveSessionPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  Object.values(ctl).forEach((f) => f.mockReset());
  useLiveStore.getState().reset();
  useLiveStore.setState({ blur: false });
  delete (window as { documentPictureInPicture?: unknown })
    .documentPictureInPicture;
});
afterEach(() => vi.restoreAllMocks());

describe("microphone toggle", () => {
  const box = () =>
    screen.getByRole("checkbox", { name: /transcribe my microphone/i });

  it("is off and disabled until capture is running", () => {
    page();
    expect(box()).toBeDisabled();
    expect(box()).not.toBeChecked();
    set({ status: "listening" });
    expect(box()).toBeEnabled();
  });

  it("turns the microphone on and off through the controller", async () => {
    page();
    set({ status: "listening" });
    await userEvent.click(box());
    expect(ctl.setMic).toHaveBeenLastCalledWith(true);
    set({ mic: "on" });
    expect(box()).toBeChecked();
    await userEvent.click(box());
    expect(ctl.setMic).toHaveBeenLastCalledWith(false);
  });

  it("shows the microphone level only while it is on, and explains an error", () => {
    page();
    set({ status: "listening", mic: "starting" });
    expect(
      screen.queryByRole("meter", { name: "Microphone level" }),
    ).toBeNull();
    set({ mic: "on", micLevel: 0.1 });
    expect(
      screen.getByRole("meter", { name: "Microphone level" }),
    ).toHaveAttribute("aria-valuenow", "40");
    set({
      mic: "error",
      micProblem:
        "Microphone access was blocked. Allow the microphone for this site.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Microphone access was blocked/,
    );
    expect(box()).not.toBeChecked();
  });

  it("explains headphones and that mic speech is labelled You and never answered", () => {
    page();
    expect(screen.getByText(/Headphones work best/)).toBeInTheDocument();
    expect(screen.getByText(/Labelled "You"/)).toBeInTheDocument();
  });

  it("says when it is in the slower fallback mode", () => {
    page();
    expect(screen.queryByText(/Fallback mode/)).toBeNull();
    set({ status: "listening", mode: "segments" });
    expect(
      screen.getByText(/Fallback mode: captions arrive after each pause/),
    ).toBeInTheDocument();
  });
});

describe("outline feedback (FR-31)", () => {
  const up = () => screen.getByRole("button", { name: "Useful" });
  const down = () => screen.getByRole("button", { name: "Not useful" });

  it("only appears once an outline is finished", () => {
    page();
    set({ outline: outline({ state: "streaming", suggestionId: undefined }) });
    expect(
      screen.queryByRole("group", { name: "Rate this outline" }),
    ).toBeNull();
    set({
      outline: outline({
        state: "error",
        suggestionId: undefined,
        error: { code: "x", message: "m" },
      }),
    });
    expect(
      screen.queryByRole("group", { name: "Rate this outline" }),
    ).toBeNull();
    set({ outline: outline() });
    expect(
      screen.getByRole("group", { name: "Rate this outline" }),
    ).toBeInTheDocument();
  });

  it("stores a thumbs up and can change it to a thumbs down", async () => {
    const calls = mockApi({
      "POST /api/suggestions/sg1/feedback": () => ({ json: { status: "ok" } }),
    });
    page();
    set({ outline: outline() });
    await userEvent.click(up());
    expect(up()).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(down());
    expect(down()).toHaveAttribute("aria-pressed", "true");
    expect(up()).toHaveAttribute("aria-pressed", "false");
    const sent = calls
      .filter((c) => c.key === "POST /api/suggestions/sg1/feedback")
      .map((c) => c.body);
    expect(sent).toEqual([{ value: "up" }, { value: "down" }]);
    const first = calls.find(
      (c) => c.key === "POST /api/suggestions/sg1/feedback",
    )!;
    expect(first.headers.get("x-requested-with")).toBe("meet-practice");
  });

  it("undoes the choice and says so if it could not be saved", async () => {
    mockApi({
      "POST /api/suggestions/sg1/feedback": () => ({
        status: 500,
        json: { error: { code: "x", message: "boom", request_id: "r" } },
      }),
    });
    page();
    set({ outline: outline() });
    await userEvent.click(up());
    expect(await screen.findByText(/Couldn't save that/)).toBeInTheDocument();
    expect(up()).toHaveAttribute("aria-pressed", "false");
  });

  it("a new outline starts with no rating", async () => {
    mockApi({
      "POST /api/suggestions/sg1/feedback": () => ({ json: { status: "ok" } }),
    });
    page();
    set({ outline: outline() });
    await userEvent.click(up());
    set({ outline: outline({ suggestionId: "sg2", question: "Next?" }) });
    expect(up()).toHaveAttribute("aria-pressed", "false");
  });
});

describe("floating panel (FR-29)", () => {
  /** A real second window (an iframe's), as Document Picture-in-Picture gives. */
  function fakePip() {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const win = frame.contentWindow!;
    const doc = win.document;
    win.close = vi.fn(() => {
      win.dispatchEvent(new Event("pagehide"));
    });
    const requestWindow = vi.fn(async () => win);
    (
      window as { documentPictureInPicture?: unknown }
    ).documentPictureInPicture = { requestWindow };
    return {
      win,
      doc,
      requestWindow,
      closeByUser: () => win.dispatchEvent(new Event("pagehide")),
    };
  }

  it("offers no button where the browser lacks the API", () => {
    page();
    expect(
      screen.queryByRole("button", { name: /Float the answer panel/ }),
    ).toBeNull();
  });

  it("moves the answer panel into its own window and keeps it working there", async () => {
    const pip = fakePip();
    page();
    set({ blur: true, outline: outline() });
    await userEvent.click(
      screen.getByRole("button", { name: /Float the answer panel/ }),
    );
    await screen.findByText(/in its own window/);
    expect(pip.requestWindow).toHaveBeenCalledWith({ width: 420, height: 560 });
    const inPip = within(pip.doc.body);
    expect(
      inPip.getByRole("heading", { name: "Question and answer" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Question and answer" }),
    ).toBeNull(); // not duplicated in the page
    // the controls still work from the floating window (they use the shared store)
    expect(inPip.getByTestId("outline").className).toMatch(/blur-sm/);
    await userEvent.click(inPip.getByRole("button", { name: "Reveal" }));
    expect(inPip.getByTestId("outline").className).not.toMatch(/blur-sm/);
    expect(pip.doc.head.querySelector("style")).toBeNull(); // jsdom has no stylesheets to copy here
  });

  it("new outlines appear in the floating window", async () => {
    const pip = fakePip();
    page();
    await userEvent.click(
      screen.getByRole("button", { name: /Float the answer panel/ }),
    );
    await screen.findByText(/in its own window/);
    set({ outline: outline({ text: "A fresh outline" }) });
    expect(within(pip.doc.body).getByTestId("outline")).toHaveTextContent(
      "A fresh outline",
    );
  });

  it("closes the window and returns the panel to the page", async () => {
    const pip = fakePip();
    page();
    await userEvent.click(
      screen.getByRole("button", { name: /Float the answer panel/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Bring it back here" }),
    );
    expect(pip.win.close).toHaveBeenCalled();
    expect(
      await screen.findByRole("heading", { name: "Question and answer" }),
    ).toBeInTheDocument();
  });

  it("returns to the page when the user closes the floating window themselves", async () => {
    const pip = fakePip();
    page();
    await userEvent.click(
      screen.getByRole("button", { name: /Float the answer panel/ }),
    );
    await screen.findByText(/in its own window/);
    act(() => pip.closeByUser());
    expect(
      await screen.findByRole("heading", { name: "Question and answer" }),
    ).toBeInTheDocument();
  });

  it("stays in the page if the browser refuses the window", async () => {
    (
      window as { documentPictureInPicture?: unknown }
    ).documentPictureInPicture = {
      requestWindow: vi.fn(async () => {
        throw new DOMException("denied", "NotAllowedError");
      }),
    };
    page();
    await userEvent.click(
      screen.getByRole("button", { name: /Float the answer panel/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Question and answer" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/in its own window/)).toBeNull();
  });

  it("links a sheet that has a URL instead of copying it inline (a strict CSP blocks inline styles)", async () => {
    const doc = document.implementation.createHTMLDocument("pip");
    const { copyStyles } = await import("./useFloatingPanel");
    copyStyles(
      {
        styleSheets: [
          {
            href: "https://app.example.com/assets/index-abc.css",
            cssRules: [],
          },
          { href: null, cssRules: [{ cssText: ".dev { color: red }" }] },
        ],
      } as unknown as Document,
      doc,
    );
    const link = doc.head.querySelector(
      "link[rel=stylesheet]",
    ) as HTMLLinkElement;
    expect(link.href).toBe("https://app.example.com/assets/index-abc.css");
    expect(doc.head.querySelectorAll("style")).toHaveLength(1); // only the URL-less (dev) sheet is inline
    expect(doc.head.querySelector("style")!.textContent).toContain(".dev");
  });

  it("copies the page's stylesheets into the new window", async () => {
    const sheet = document.createElement("style");
    sheet.textContent = ".probe { color: red }";
    document.head.appendChild(sheet);
    const pip = fakePip();
    page();
    await userEvent.click(
      screen.getByRole("button", { name: /Float the answer panel/ }),
    );
    await screen.findByText(/in its own window/);
    expect(pip.doc.head.textContent).toContain(".probe");
    sheet.remove();
  });
});
