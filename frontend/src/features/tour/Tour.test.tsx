import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tour } from "./Tour";
import { TOUR_STEPS } from "./steps";

const steps = [
  { id: "a", title: "First", body: "Body one." },
  { id: "b", target: "thing", title: "Second", body: "Body two." },
  { id: "c", target: "missing", title: "Third", body: "Body three." },
];

function Page({ onClose }: { onClose: (f: boolean) => void }) {
  return (
    <>
      <button data-tour="thing">A real thing</button>
      <Tour steps={steps} onClose={onClose} />
    </>
  );
}

describe("Tour", () => {
  it("opens on the first step and moves forward and back", async () => {
    render(<Page onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "First" });
    expect(dialog).toHaveTextContent("Step 1 of 3");
    expect(dialog).toHaveTextContent("Body one.");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("dialog", { name: "Second" })).toHaveTextContent(
      "Step 2 of 3",
    );
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "First" })).toBeInTheDocument();
  });

  it("finishes on the last step and says so", async () => {
    const onClose = vi.fn();
    render(<Page onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("can be skipped at any step, with the button or Escape", async () => {
    const onClose = vi.fn();
    render(<Page onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(onClose).toHaveBeenLastCalledWith(false);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenLastCalledWith(false);
  });

  it("puts a ring around the real item when a step has one", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100,
      left: 20,
      width: 120,
      height: 40,
      right: 140,
      bottom: 140,
      x: 20,
      y: 100,
      toJSON: () => ({}),
    });
    render(<Page onClose={vi.fn()} />);
    expect(screen.queryByTestId("tour-spotlight")).toBeNull(); // step one has no target
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    const ring = screen.getByTestId("tour-spotlight");
    expect(ring).toHaveStyle({ top: "94px", left: "14px" });
    vi.restoreAllMocks();
  });

  it("shows the same words in the middle of the screen when the item is not there", async () => {
    render(<Page onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    // "missing" is not on the page (as the menu is not on a phone)
    expect(screen.getByRole("dialog", { name: "Third" })).toHaveTextContent(
      "Body three.",
    );
    expect(screen.queryByTestId("tour-spotlight")).toBeNull();
  });

  it("keeps keyboard focus on the card: Next is focused, and Tab wraps around", async () => {
    render(<Page onClose={vi.fn()} />);
    const next = screen.getByRole("button", { name: "Start" });
    expect(next).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Skip tour" })).toHaveFocus(); // wrapped to the first
    await userEvent.tab({ shift: true });
    expect(next).toHaveFocus();
  });

  it("is a modal dialog with a title and a description", () => {
    render(<Page onClose={vi.fn()} />);
    const d = screen.getByRole("dialog");
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(d).toHaveAccessibleName("First");
    expect(d).toHaveAccessibleDescription("Body one.");
  });
});

describe("the tour's steps", () => {
  it("cover the CV, companies, practice, the live panel, reviewing, free sessions and the account", () => {
    const titles = TOUR_STEPS.map((s) => s.title).join(" | ");
    for (const word of [
      "CV",
      "company",
      "mock interview",
      "live panel",
      "Review",
      "Free sessions",
      "account",
    ])
      expect(titles.toLowerCase()).toContain(word.toLowerCase());
  });

  it("have unique ids, and every target is a real data-tour name used in the app", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const allowed = [
      "search",
      "nav-notes",
      "nav-companies",
      "nav-session-new",
      "nav-sessions",
      "nav-referrals",
      "profile",
    ];
    for (const s of TOUR_STEPS)
      if (s.target) expect(allowed).toContain(s.target);
  });

  it("describe the live panel's rule the way the panel really works", () => {
    const panel = TOUR_STEPS.find((s) => s.id === "panel")!;
    expect(panel.body).toMatch(/stays put/);
    expect(panel.body).toMatch(/Done, next question/);
    expect(panel.body).toMatch(/not a question changes nothing/);
  });
});
