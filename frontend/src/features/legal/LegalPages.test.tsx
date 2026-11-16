import { screen } from "@testing-library/react";

import { App } from "../../app/App";
import {
  ME,
  UNAUTH,
  mockApi,
  renderApp,
  stubSupportedBrowser,
} from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

describe("terms and privacy", () => {
  it("are public: readable without signing in", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/terms");
    expect(
      await screen.findByRole("heading", { name: "Terms of use" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("state the practice-only rule, consent, the law and that there is no concealment feature", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/terms");
    await screen.findByRole("heading", { name: "Terms of use" });
    expect(
      screen.getByText(
        /for practising interviews with a friend, mentor or peer who knows/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no feature to hide the assistant/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/get their agreement before each session/),
    ).toBeInTheDocument();
    expect(screen.getByText(/differ by country and state/)).toBeInTheDocument();
    expect(screen.getByText(/never signs in anywhere/)).toBeInTheDocument();
  });

  it("the privacy notice says audio is not stored and names the third party", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/privacy");
    expect(
      await screen.findByRole("heading", { name: "Privacy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Audio\. It is relayed for transcription and discarded/),
    ).toBeInTheDocument();
    expect(screen.getByText(/sent to OpenAI/)).toBeInTheDocument();
    expect(
      screen.getByText(/within 30 days|storage within 30 days/),
    ).toBeInTheDocument();
    expect(screen.getByText(/never content/)).toBeInTheDocument();
  });

  it("are clearly marked as a draft needing legal review", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/privacy");
    expect(await screen.findByRole("note")).toHaveTextContent(
      /needs review by a lawyer/,
    );
  });

  it("the sign-in page links to both before the user agrees", async () => {
    mockApi({ "GET /api/me": () => UNAUTH });
    renderApp(<App />, "/login");
    expect(await screen.findByRole("link", { name: "terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(
      screen.getByRole("link", { name: "privacy notice" }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      screen.getByText(
        /Practice only, with a partner who knows the assistant is on/,
      ),
    ).toBeInTheDocument();
  });

  it("every signed-in page has a footer with both links", async () => {
    mockApi({
      "GET /api/me": () => ({ json: ME }),
      "GET /api/notes": () => ({
        json: { role: "", content: "", updated_at: null },
      }),
    });
    renderApp(<App />, "/notes");
    await screen.findByRole("heading", { name: "Your notes" });
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});
