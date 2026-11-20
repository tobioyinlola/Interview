import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

vi.mock("../../api/polling", async (orig) => ({
  ...(await orig<typeof import("../../api/polling")>()),
  POLL_MS: 20,
}));

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const score = (over = {}) => ({
  id: "sc1",
  utterance_id: "u2",
  question_text: "Tell me about a project?",
  answer_text: "In 2025 I led the checkout launch with six people.",
  structure: 70,
  specificity: 60,
  impact: 50,
  relevance: 80,
  pace: 90,
  overall: 70,
  fixes: ["Open with the result.", "Add one number."],
  ...over,
});
const outline = (over = {}) => ({
  id: "g1",
  utterance_id: "u1",
  question_text: "Why us?",
  type: "company",
  output_text:
    "TYPE: company\nANSWER: Acme sells payment software and I led a launch.\nSOURCES:\n- Acme sells POS [brief: Acme site]\n- Led launch [note: Launch]",
  first_token_ms: 1,
  total_ms: 2,
  grounding_flags: [],
  feedback: null,
  created_at: "x",
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
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
  suggestions: [outline()],
  scoring_status: "none",
  scoring_error: null,
  scores: [],
  gaps: [],
  ...over,
});
const me = { "GET /api/me": () => ({ json: ME }) };
const open = () => renderApp(<App />, "/sessions/s1");
const err = (status: number, code: string, message: string) => ({
  status,
  json: { error: { code, message, request_id: "r" } },
});

describe("ReviewPage: transcript", () => {
  it("shows each outline beside its question, typed questions, ratings and a download", async () => {
    mockApi({
      ...me,
      "GET /api/sessions/s1": () => ({
        json: detail({
          suggestions: [
            outline({ feedback: "up" }),
            outline({
              id: "g2",
              utterance_id: null,
              question_text: "Typed question?",
              output_text: "TYPE: other",
            }),
          ],
        }),
      }),
    });
    open();
    expect(
      await screen.findByRole("heading", { name: "Session review" }),
    ).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "Transcript" });
    const items = Array.from(
      region.querySelectorAll<HTMLElement>(":scope > ol > li"),
    ); // not the source labels inside them
    expect(within(items[0]).getByText(/Why us\?/)).toBeInTheDocument();
    // the answer is shown as plain text, never the model's headings, and its sources as labels
    expect(
      within(items[0]).getByText(/Acme sells payment software and I led/),
    ).toBeInTheDocument();
    expect(items[0]).not.toHaveTextContent(/TYPE|ANSWER:|SOURCES/);
    expect(
      within(within(items[0]).getByRole("list", { name: "Sources" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["brief: Acme site", "note: Launch"]);
    expect(within(items[0]).getByText("Marked useful")).toBeInTheDocument();
    expect(within(items[1]).getByText("You:")).toBeInTheDocument();
    expect(within(items[1]).queryByText(/TYPE/)).toBeNull();
    expect(within(items[2]).getByText("Typed:")).toBeInTheDocument();
    expect(
      screen
        .getByRole("link", { name: "Download transcript" })
        .getAttribute("href"),
    ).toMatch(/\/api\/sessions\/s1\/transcript\.txt$/);
  });

  it("handles a session that is not found", async () => {
    mockApi({
      ...me,
      "GET /api/sessions/s1": () =>
        err(404, "session_not_found", "Session not found."),
    });
    open();
    expect(await screen.findByText(/was not found/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to sessions" }),
    ).toHaveAttribute("href", "/sessions");
  });
});

describe("ReviewPage: answer scoring (FR-36)", () => {
  it("scores the answers in the background, shows progress, then the cards", async () => {
    let status = "none";
    let polls = 0;
    const calls = mockApi({
      ...me,
      "GET /api/sessions/s1": () => {
        if (status === "running" && ++polls >= 3) status = "ready";
        return {
          json: detail({
            scoring_status: status,
            scores:
              status === "ready"
                ? [
                    score(),
                    score({
                      id: "sc2",
                      question_text: "How did you measure it?",
                      overall: 55,
                    }),
                  ]
                : [],
          }),
        };
      },
      "POST /api/sessions/s1/score": () => {
        status = "running";
        return { status: 202, json: { status: "running" } };
      },
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Score my answers" }),
    );
    expect(await screen.findByText(/Scoring your answers/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Score my answers" }),
    ).toBeDisabled(); // one job at a time

    const cards = await screen.findByRole("list", { name: "Answer scores" });
    const first = within(cards).getAllByRole("listitem")[0];
    expect(
      within(first).getByLabelText("Overall score 70 out of 100"),
    ).toBeInTheDocument();
    for (const [label, value] of [
      ["Structure", "70"],
      ["Specificity", "60"],
      ["Impact", "50"],
      ["Relevance", "80"],
      ["Pace", "90"],
    ]) {
      expect(
        within(first).getByRole("meter", { name: `${label} score` }),
      ).toHaveAttribute("aria-valuenow", value);
    }
    expect(
      within(first).getByText("Open with the result."),
    ).toBeInTheDocument();
    expect(within(first).getByText("Add one number.")).toBeInTheDocument();
    expect(
      within(first).getByText(/Tell me about a project\?/),
    ).toBeInTheDocument();
    expect(within(first).getByText(/checkout launch/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Score again" })).toBeEnabled();
    expect(screen.queryByText(/Scoring your answers/)).toBeNull();
    expect(
      calls
        .find((c) => c.key === "POST /api/sessions/s1/score")!
        .headers.get("x-requested-with"),
    ).toBe("meet-practice");
  });

  it("stops polling once scoring has finished", async () => {
    let gets = 0;
    mockApi({
      ...me,
      "GET /api/sessions/s1": () => {
        gets++;
        return { json: detail({ scoring_status: "ready", scores: [score()] }) };
      },
    });
    open();
    await screen.findByRole("list", { name: "Answer scores" });
    const settled = gets;
    await new Promise((r) => setTimeout(r, 120));
    expect(gets).toBe(settled);
  });

  it("picks up a job that was already running when the page opened", async () => {
    let n = 0;
    mockApi({
      ...me,
      "GET /api/sessions/s1": () =>
        ++n < 3
          ? { json: detail({ scoring_status: "running" }) }
          : { json: detail({ scoring_status: "ready", scores: [score()] }) },
    });
    open();
    expect(await screen.findByText(/Scoring your answers/)).toBeInTheDocument();
    expect(
      await screen.findByRole("list", { name: "Answer scores" }),
    ).toBeInTheDocument();
  });

  it("explains a failure and lets the user retry", async () => {
    let status = "failed";
    const calls = mockApi({
      ...me,
      "GET /api/sessions/s1": () => ({
        json: detail({
          scoring_status: status,
          scoring_error:
            status === "failed"
              ? "The AI returned an unreadable score. Try again."
              : null,
          scores: status === "ready" ? [score()] : [],
        }),
      }),
      "POST /api/sessions/s1/score": () => {
        status = "ready";
        return { status: 202, json: { status: "running" } };
      },
    });
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /unreadable score.*Press Score to try again/,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Score my answers" }),
    );
    expect(
      await screen.findByRole("list", { name: "Answer scores" }),
    ).toBeInTheDocument();
    expect(
      calls.filter((c) => c.key === "POST /api/sessions/s1/score"),
    ).toHaveLength(1);
  });

  it("says how to get answers recorded when there is nothing to score", async () => {
    mockApi({
      ...me,
      "GET /api/sessions/s1": () => ({
        json: detail({ scoring_status: "ready", scores: [] }),
      }),
    });
    open();
    expect(await screen.findByText(/No answers to score/)).toHaveTextContent(
      /Also transcribe my microphone/,
    );
  });

  it("does not offer scoring for a session that has not ended", async () => {
    mockApi({
      ...me,
      "GET /api/sessions/s1": () => ({
        json: detail({ status: "active", ended_at: null }),
      }),
    });
    open();
    expect(
      await screen.findByText(/End the session to score your answers/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Score/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Back to the live session" }),
    ).toHaveAttribute("href", "/session/s1");
  });

  it("shows the server's reason if scoring cannot start", async () => {
    mockApi({
      ...me,
      "GET /api/sessions/s1": () => ({ json: detail() }),
      "POST /api/sessions/s1/score": () =>
        err(429, "daily_cap", "Daily limit reached."),
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Score my answers" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Daily limit reached.",
    );
  });
});

describe("ReviewPage: gap finder (FR-37)", () => {
  it("lists question types and company topics with nothing to draw on, and what to add", async () => {
    mockApi({
      ...me,
      "GET /api/sessions/s1": () => ({
        json: detail({
          gaps: [
            {
              kind: "experience",
              type: "behavioral",
              questions: ["Tell me about a failure?"],
              hint: "Add a behavioral story to your notes.",
            },
            {
              kind: "company",
              type: "company",
              questions: ["Why us?"],
              hint: "Add facts about the company.",
            },
          ],
        }),
      }),
    });
    open();
    const g = within(
      await screen.findByRole("region", {
        name: "Gaps in your CV and brief",
      }),
    );
    expect(
      g.getByText("No matching story for behavioral questions"),
    ).toBeInTheDocument();
    expect(g.getByText("Tell me about a failure?")).toBeInTheDocument();
    expect(g.getByRole("link", { name: "Add a note" })).toHaveAttribute(
      "href",
      "/notes",
    );
    expect(
      g.getByText("Company questions without brief facts"),
    ).toBeInTheDocument();
    expect(g.getByRole("link", { name: "Open companies" })).toHaveAttribute(
      "href",
      "/companies",
    );
  });

  it("says so when there are no gaps", async () => {
    mockApi({ ...me, "GET /api/sessions/s1": () => ({ json: detail() }) });
    open();
    expect(await screen.findByText(/No gaps found/)).toBeInTheDocument();
  });
});

describe("ReviewPage: delete", () => {
  it("asks first, then deletes and returns to the list", async () => {
    let deleted = false;
    const calls = mockApi({
      ...me,
      "GET /api/sessions/s1": () => ({ json: detail() }),
      "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
      "DELETE /api/sessions/s1": () => {
        deleted = true;
        return { json: { status: "ok" } };
      },
    });
    open();
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete this session" }),
    );
    expect(calls.some((c) => c.key === "DELETE /api/sessions/s1")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete this session" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(
      await screen.findByRole("heading", { name: "Sessions" }),
    ).toBeInTheDocument();
    expect(deleted).toBe(true);
  });
});
