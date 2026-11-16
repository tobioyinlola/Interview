import { render, screen, within } from "@testing-library/react";

import type { Brief } from "../../api/types";
import { BriefView } from "./BriefView";
import { BRIEF, SOURCES, src } from "./fixtures";

const show = (brief: Brief = BRIEF, sources = SOURCES) =>
  render(<BriefView brief={brief} sources={sources} />);

describe("BriefView", () => {
  it("shows each fact with a numbered link to its real source", () => {
    show();
    const snapshot = screen.getByRole("region", { name: "Snapshot" });
    expect(
      within(snapshot).getByText("Acme builds payment software."),
    ).toBeInTheDocument();
    const link = within(snapshot).getByRole("link", {
      name: /Source 1: About Acme/,
    });
    expect(link).toHaveAttribute("href", "https://acme.com/about");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    const news = screen.getByRole("region", { name: "Recent news" });
    expect(within(news).getByText("May 2026")).toBeInTheDocument();
    expect(
      within(news).getByRole("link", { name: /Source 2/ }),
    ).toHaveAttribute("href", "https://news.example.com/a");
  });

  it('says "Not found" for an empty section, never filler', () => {
    show();
    const s = screen.getByRole("region", { name: "Interview process" });
    expect(within(s).getByText("Not found")).toBeInTheDocument();
    expect(within(s).queryByRole("listitem")).toBeNull();
  });

  it("labels suggestions so they are not mistaken for facts", () => {
    show();
    const s = screen.getByRole("region", { name: "Likely questions" });
    expect(within(s).getByText("Suggestion")).toBeInTheDocument();
    expect(within(s).getByText(/not facts/i)).toBeInTheDocument();
  });

  it("labels text the user supplied", () => {
    const brief: Brief = structuredClone(BRIEF);
    brief.sections[0].facts[0].label = "pasted_by_you";
    brief.sections[1].facts[0].label = "from_you";
    show(brief);
    expect(screen.getByText("Pasted by you")).toBeInTheDocument();
    expect(screen.getByText("From you")).toBeInTheDocument();
  });

  it("states which company it assumed, and when search or the website was missing", () => {
    show({
      ...BRIEF,
      assumed_company: "Acme Ltd, a UK payments company",
      no_website: true,
      web_search_done: false,
    });
    expect(screen.getByText(/Assumed company:/)).toBeInTheDocument();
    expect(screen.getByText(/UK payments company/)).toBeInTheDocument();
    expect(screen.getByText(/web search only/i)).toBeInTheDocument();
    expect(screen.getByText(/Web search wasn't done/i)).toBeInTheDocument();
  });

  it("never turns a non-web URL into an external link", () => {
    show(BRIEF, [
      src({ id: "s1", url: "javascript:alert(1)", title: "Evil" }),
      src({ id: "s2", url: "ftp://x.com/a", title: "Ftp" }),
    ]);
    for (const a of screen.getAllByRole("link")) {
      expect(a.getAttribute("href")).not.toMatch(/^(javascript|ftp):/i);
      expect(a).not.toHaveAttribute("target");
    }
  });

  it("renders fact text as text, never as HTML", () => {
    const brief: Brief = structuredClone(BRIEF);
    brief.sections[0].facts[0].text =
      '<img src=x onerror="alert(1)"> <b>bold</b>';
    const { container } = show(brief);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });
});
