import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const open = () => {
  mockApi({
    "GET /api/me": () => ({
      json: { ...ME, onboarded: true, tour_done: true },
    }),
  });
  renderApp(<App />, "/help");
};

describe("HelpPage", () => {
  it("has a quick start whose steps link to the right pages", async () => {
    open();
    const qs = within(
      await screen.findByRole("region", { name: "Quick start" }),
    );
    expect(qs.getByRole("link", { name: "Upload your CV" })).toHaveAttribute(
      "href",
      "/settings/cv",
    );
    expect(qs.getByRole("link", { name: "Add the company" })).toHaveAttribute(
      "href",
      "/companies",
    );
    expect(
      qs.getByRole("link", { name: "Start an interview" }),
    ).toHaveAttribute("href", "/session/new");
    expect(qs.getByRole("link", { name: "Review afterwards" })).toHaveAttribute(
      "href",
      "/sessions",
    );
    expect(qs.getAllByRole("listitem")).toHaveLength(5);
  });

  it("explains the live panel's rule: it stays until a new question or Done", async () => {
    open();
    const panel = within(
      await screen.findByRole("region", { name: "How the live panel works" }),
    );
    expect(
      panel.getByText(/Once an answer is up it stays/),
    ).toBeInTheDocument();
    expect(panel.getByText(/Done, next question/)).toBeInTheDocument();
    expect(
      panel.getByText(/Remarks that are not questions change nothing/),
    ).toBeInTheDocument();
  });

  it("answers common questions, each opening on click", async () => {
    open();
    const faq = await screen.findByRole("region", { name: "Common questions" });
    const q = within(faq).getByText("Can I use it in a real interview?");
    const details = q.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(q);
    expect(details).toHaveAttribute("open");
    expect(
      within(details).getByText(/No\. InterviewMeet is for mock interviews/),
    ).toBeInTheDocument();
  });

  it("states the practice-only rule and the free-session rules, matching the app", async () => {
    open();
    await screen.findByRole("heading", { name: "Help" });
    expect(
      screen.getByText(/Your first session is free\. After that/),
    ).toBeInTheDocument();
    expect(screen.getByText(/three friends who sign up/)).toBeInTheDocument();
  });

  it("is reachable from the search and the account menu, not the sidebar", async () => {
    open();
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(nav.queryByRole("link", { name: "Help" })).toBeNull();
    expect(nav.queryByRole("link", { name: "Privacy" })).toBeNull();
    expect(nav.queryByRole("link", { name: "Terms" })).toBeNull();
    await userEvent.type(screen.getByRole("combobox"), "tour");
    expect(
      await screen.findByRole("option", { name: /Help/ }),
    ).toBeInTheDocument();
  });
});
