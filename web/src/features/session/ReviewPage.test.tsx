import { screen, within } from "@testing-library/react";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const detail = {
  id: "s1",
  status: "ended",
  company_id: null,
  role: "PM",
  started_at: "2026-11-16T10:00:00Z",
  ended_at: "2026-11-16T10:20:00Z",
  consent_confirmed_at: "2026-11-16T10:00:00Z",
  utterances: [
    {
      id: "u1",
      seq: 1,
      speaker: "partner",
      text: "Why us?",
      started_at: null,
      ended_at: null,
    },
    {
      id: "u2",
      seq: 2,
      speaker: "you",
      text: "Because...",
      started_at: null,
      ended_at: null,
    },
  ],
  suggestions: [
    {
      id: "g1",
      utterance_id: "u1",
      question_text: "Why us?",
      type: "company",
      output_text: "TYPE: company\nPOINTS:\n- x",
      first_token_ms: 1,
      total_ms: 2,
      grounding_flags: [],
      feedback: null,
      created_at: "x",
    },
    {
      id: "g2",
      utterance_id: null,
      question_text: "Typed question?",
      type: "other",
      output_text: "TYPE: other",
      first_token_ms: 1,
      total_ms: 2,
      grounding_flags: [],
      feedback: null,
      created_at: "x",
    },
  ],
};

describe("ReviewPage", () => {
  it("shows the transcript with each outline beside its question, and a download", async () => {
    mockApi({
      "GET /api/me": () => ({ json: ME }),
      "GET /api/sessions/s1": () => ({ json: detail }),
    });
    renderApp(<App />, "/sessions/s1");
    expect(
      await screen.findByRole("heading", { name: "Session review" }),
    ).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText(/Why us\?/)).toBeInTheDocument();
    expect(within(items[0]).getByText(/TYPE: company/)).toBeInTheDocument(); // outline beside its question
    expect(within(items[1]).getByText("You:")).toBeInTheDocument();
    expect(within(items[1]).queryByText(/TYPE/)).toBeNull();
    expect(within(items[2]).getByText("Typed:")).toBeInTheDocument(); // typed questions have outlines too
    expect(
      screen
        .getByRole("link", { name: "Download transcript" })
        .getAttribute("href"),
    ).toMatch(/\/api\/sessions\/s1\/transcript\.txt$/);
  });

  it("handles a session that is not found", async () => {
    mockApi({
      "GET /api/me": () => ({ json: ME }),
      "GET /api/sessions/s1": () => ({
        status: 404,
        json: {
          error: {
            code: "session_not_found",
            message: "Session not found.",
            request_id: "r",
          },
        },
      }),
    });
    renderApp(<App />, "/sessions/s1");
    expect(await screen.findByText(/was not found/)).toBeInTheDocument();
  });
});
