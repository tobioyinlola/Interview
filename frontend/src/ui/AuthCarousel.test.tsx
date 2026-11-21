import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../app/App";
import { mockApi, renderApp, stubSupportedBrowser } from "../test-utils";
import { AuthCarousel } from "./AuthCarousel";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const heading = () => screen.getByRole("heading", { level: 2 }).textContent;

describe("AuthCarousel", () => {
  it("shows three slides about what the product does, one at a time", () => {
    render(<AuthCarousel />);
    expect(heading()).toBe("Know the company before they ask");
    expect(screen.getByRole("group", { name: "1 of 3" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Show slide/ })).toHaveLength(
      3,
    );
  });

  it("moves with next, previous and the dots, and wraps around", async () => {
    render(<AuthCarousel />);
    await userEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(heading()).toBe("A strong answer, the moment they ask");
    await userEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(heading()).toBe("Review, score and improve");
    await userEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(heading()).toBe("Know the company before they ask");
    await userEvent.click(
      screen.getByRole("button", { name: "Previous slide" }),
    );
    expect(heading()).toBe("Review, score and improve");
    await userEvent.click(screen.getByRole("button", { name: /Show slide 2/ }));
    expect(heading()).toBe("A strong answer, the moment they ask");
    expect(
      screen.getByRole("button", { name: /Show slide 2/ }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("turns by itself, and the pause button stops it", () => {
    vi.useFakeTimers();
    render(<AuthCarousel />);
    act(() => vi.advanceTimersByTime(6000));
    expect(heading()).toBe("A strong answer, the moment they ask");
    act(() =>
      screen.getByRole("button", { name: "Pause the slideshow" }).click(),
    );
    act(() => vi.advanceTimersByTime(30_000));
    expect(heading()).toBe("A strong answer, the moment they ask");
    act(() =>
      screen.getByRole("button", { name: "Play the slideshow" }).click(),
    );
    act(() => vi.advanceTimersByTime(6000));
    expect(heading()).toBe("Review, score and improve");
  });

  it("stands still while the pointer is on it, and turns again when it leaves", () => {
    vi.useFakeTimers();
    render(<AuthCarousel />);
    const region = screen.getByRole("region", {
      name: "What InterviewMeet does",
    });
    fireEvent.mouseEnter(region);
    act(() => vi.advanceTimersByTime(30_000));
    expect(heading()).toBe("Know the company before they ask");
    fireEvent.mouseLeave(region);
    act(() => vi.advanceTimersByTime(6000));
    expect(heading()).toBe("A strong answer, the moment they ask");
  });

  it("also stands still while a control inside it has keyboard focus", () => {
    vi.useFakeTimers();
    render(<AuthCarousel />);
    const next = screen.getByRole("button", { name: "Next slide" });
    act(() => next.focus());
    act(() => vi.advanceTimersByTime(30_000));
    expect(heading()).toBe("Know the company before they ask");
    act(() => next.blur());
    act(() => vi.advanceTimersByTime(6000));
    expect(heading()).toBe("A strong answer, the moment they ask");
  });

  it("announces slide changes only when it is not turning by itself", async () => {
    render(<AuthCarousel />);
    expect(screen.getByRole("group", { name: "1 of 3" })).toHaveAttribute(
      "aria-live",
      "off",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pause the slideshow" }),
    );
    expect(screen.getByRole("group", { name: "1 of 3" })).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("does not move, and has no pause button, for people who ask for less motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    vi.useFakeTimers();
    render(<AuthCarousel />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(heading()).toBe("Know the company before they ask");
    expect(screen.queryByRole("button", { name: /slideshow/ })).toBeNull();
  });

  it("labels every drawing as an example", () => {
    render(<AuthCarousel />);
    expect(screen.getByText("Example")).toBeInTheDocument();
  });
});

describe("the sign-in and sign-up pages", () => {
  beforeEach(() => stubSupportedBrowser());

  const signedOut = () =>
    mockApi({
      "GET /api/me": () => ({
        status: 401,
        json: {
          error: { code: "not_authenticated", message: "x", request_id: "r" },
        },
      }),
      "GET /api/auth/providers": () => ({ json: { google: false } }),
    });

  it.each(["/login", "/signup", "/forgot-password"])(
    "%s has the showcase beside the form",
    async (path) => {
      signedOut();
      renderApp(<App />, path);
      const showcase = await screen.findByTestId("auth-showcase");
      expect(showcase).toHaveClass("hidden", "lg:block"); // gone on a phone and a tablet
      expect(
        within(showcase).getByRole("region", {
          name: "What InterviewMeet does",
        }),
      ).toBeInTheDocument();
      expect(screen.getByRole("main")).toBeInTheDocument();
    },
  );

  it("keeps the form after the showcase, so it sits on the right", async () => {
    signedOut();
    renderApp(<App />, "/login");
    const showcase = await screen.findByTestId("auth-showcase");
    const main = screen.getByRole("main");
    expect(
      showcase.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(showcase.parentElement).toHaveClass("lg:grid", "lg:grid-cols-2");
  });
});
