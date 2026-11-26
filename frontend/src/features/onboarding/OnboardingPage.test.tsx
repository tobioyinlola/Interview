import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";
import {
  ARRANGEMENTS,
  FOCUS,
  HELPS,
  SEARCHES,
  GOALS,
  LEVELS,
  MAX_FOCUS,
  PLAN,
  STEPS,
  TIMELINES,
  entries,
} from "./content";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const NAMED = {
  ...ME,
  full_name: "Jordan Reyes",
  onboarded: false,
  onboarding: null,
};
const ANSWERS = {
  goal: "new_job",
  level: "senior",
  timeline: "few_weeks",
  focus: ["structure", "results"],
};

const dashboardRoutes = {
  "GET /api/notes": () => ({
    json: { role: "", content: "", updated_at: null },
  }),
  "GET /api/companies": () => ({ json: [] }),
  "GET /api/sessions": () => ({ json: { items: [], next_cursor: null } }),
};

function api(
  me: object = NAMED,
  extra: Record<string, (a: never) => object> = {},
) {
  let current = me;
  return mockApi({
    "GET /api/me": () => ({ json: current }),
    "PUT /api/onboarding": ({ body }: { body: Record<string, unknown> }) => {
      current = {
        ...(me as object),
        onboarded: true,
        onboarding: {
          goal: body.goal ?? null,
          level: body.level ?? null,
          timeline: body.timeline ?? null,
          focus: body.focus ?? [],
          help: body.help ?? [],
          search: body.search ?? null,
          arrangement: body.arrangement ?? [],
        },
      };
      return { json: current };
    },
    ...dashboardRoutes,
    ...(extra as Record<string, () => object>),
  } as never);
}

const pick = (name: string | RegExp) =>
  userEvent.click(screen.getByRole("radio", { name }));
/** From the last interview question to the help question, choosing only mock interviews. */
const practise = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await userEvent.click(
    screen.getByRole("checkbox", { name: /Practise interviews/ }),
  );
};
const next = () =>
  userEvent.click(screen.getByRole("button", { name: "Continue" }));

async function walk(until: 1 | 2 | 3 | 4 | 5 = 5) {
  await screen.findByRole("heading", { name: STEPS[0].title });
  await pick(/A new job/);
  await next();
  if (until === 1) return;
  await userEvent.type(
    screen.getByLabelText(/What role are you aiming for/),
    "Senior Product Manager",
  );
  await pick(/^.*Senior/);
  await next();
  if (until === 2) return;
  await pick(/In the next few weeks/);
  await next();
  if (until === 3) return;
  await userEvent.click(
    screen.getByRole("checkbox", { name: /Structuring my answers/ }),
  );
  await userEvent.click(
    screen.getByRole("checkbox", { name: /Backing claims with results/ }),
  );
  if (until === 4) return;
  await next();
  // the help question: practising interviews only, so the job-search questions are not asked
  await userEvent.click(
    screen.getByRole("checkbox", { name: /Practise interviews/ }),
  );
}

describe("the onboarding redirect", () => {
  it("takes a person who has not onboarded to onboarding from any signed-in page", async () => {
    api();
    const { unmount } = renderApp(<App />, "/dashboard");
    expect(
      await screen.findByRole("heading", { name: STEPS[0].title }),
    ).toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();
    stubSupportedBrowser();
    api();
    renderApp(<App />, "/notes");
    expect(
      await screen.findByRole("heading", { name: STEPS[0].title }),
    ).toBeInTheDocument();
  });

  it("leaves people alone once they have onboarded, or skipped", async () => {
    api({ ...NAMED, onboarded: true });
    renderApp(<App />, "/dashboard");
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
  });

  it("does not trap accounts that predate onboarding (no flag at all)", async () => {
    api(ME);
    renderApp(<App />, "/dashboard");
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
  });

  it("lets an onboarded person come back to change their answers", async () => {
    api({ ...NAMED, onboarded: true, onboarding: ANSWERS });
    renderApp(<App />, "/onboarding");
    await screen.findByRole("heading", { name: STEPS[0].title });
    expect(screen.getByRole("radio", { name: /A new job/ })).toBeChecked();
  });

  it("is only for signed-in people", async () => {
    mockApi({
      "GET /api/me": () => ({
        status: 401,
        json: {
          error: { code: "not_authenticated", message: "x", request_id: "r" },
        },
      }),
    });
    renderApp(<App />, "/onboarding");
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });
});

describe("the four steps", () => {
  it("asks what the person is preparing for, with every answer as a radio choice", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await screen.findByRole("heading", { name: "What are you preparing for?" });
    const group = screen.getByRole("group", {
      name: "What are you preparing for?",
    });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(radios.map((r) => r.getAttribute("value"))).toEqual(
      Object.keys(GOALS),
    );
    expect(
      screen.getByText(/So your interviews fit what's at stake/),
    ).toBeInTheDocument();
  });

  it("shows where you are: step number, a progress bar, and the same on every step", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await screen.findByText("Step 1 of 5");
    const bar = screen.getByRole("progressbar", {
      name: "Onboarding progress",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    await pick(/A new job/);
    await next();
    expect(await screen.findByText("Step 2 of 5")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
  });

  it("will not continue until the question is answered", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await screen.findByRole("heading", { name: STEPS[0].title });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await pick(/A promotion/);
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("asks about role and experience on step two, and the role is optional", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await walk(1);
    expect(
      await screen.findByRole("heading", { name: STEPS[1].title }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/What role are you aiming for/),
    ).toBeInTheDocument();
    expect(screen.getByText("(optional)")).toBeInTheDocument();
    const level = screen.getByRole("group", {
      name: "How experienced are you?",
    });
    expect(
      within(level)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("value")),
    ).toEqual(Object.keys(LEVELS));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled(); // level still needed
  });

  it("asks when the interview is on step three", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await walk(2);
    expect(
      await screen.findByRole("heading", { name: STEPS[2].title }),
    ).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toEqual(
      Object.keys(TIMELINES),
    );
  });

  it("offers every focus area as a checkbox on step four, and needs at least one", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await walk(3);
    expect(
      await screen.findByRole("heading", { name: STEPS[3].title }),
    ).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("value"))).toEqual(
      Object.keys(FOCUS),
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.click(boxes[0]);
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("allows at most three focus areas and says how many are chosen", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await walk(3);
    await screen.findByRole("heading", { name: STEPS[3].title });
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    for (const b of boxes.slice(0, MAX_FOCUS)) await userEvent.click(b);
    expect(screen.getByText("3 of 3 chosen")).toBeInTheDocument();
    for (const b of boxes.slice(MAX_FOCUS)) expect(b).toBeDisabled();
    await userEvent.click(boxes[0]);
    expect(screen.getByText("2 of 3 chosen")).toBeInTheDocument();
    expect(boxes[MAX_FOCUS]).toBeEnabled();
  });

  it("moves back without losing answers", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await walk(2);
    await screen.findByRole("heading", { name: STEPS[2].title });
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: STEPS[1].title });
    expect(
      screen.getByDisplayValue("Senior Product Manager"),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Senior/ })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("radio", { name: /A new job/ })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull(); // nothing before step one
  });

  it("moves keyboard focus to each new question so screen readers announce it", async () => {
    api();
    renderApp(<App />, "/onboarding");
    const first = await screen.findByRole("heading", { name: STEPS[0].title });
    expect(first).toHaveFocus();
    await pick(/A new job/);
    await next();
    expect(
      await screen.findByRole("heading", { name: STEPS[1].title }),
    ).toHaveFocus();
  });
});

describe("the person's name", () => {
  it("is asked for on step one only when we do not have it, and is required", async () => {
    api({ ...ME, onboarded: false, full_name: null });
    renderApp(<App />, "/onboarding");
    const field = await screen.findByLabelText("What should we call you?");
    expect(field).toHaveAttribute("autocomplete", "name");
    await pick(/A new job/);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled(); // no name yet
    await userEvent.type(field, "Ada Lovelace");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("is not asked for when it is already known", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await screen.findByRole("heading", { name: STEPS[0].title });
    expect(screen.queryByLabelText("What should we call you?")).toBeNull();
  });

  it("is sent with the answers when it was missing, and greets the person at the end", async () => {
    const calls = api({ ...ME, onboarded: false, full_name: null });
    renderApp(<App />, "/onboarding");
    await userEvent.type(
      await screen.findByLabelText("What should we call you?"),
      "  Ada Lovelace ",
    );
    await pick(/A new job/);
    await next();
    await pick(/Senior/);
    await next();
    await pick(/In the next few weeks/);
    await next();
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    await practise();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      await screen.findByRole("heading", { name: /You're all set, Ada/ }),
    ).toBeInTheDocument();
    expect(
      calls.find((c) => c.key === "PUT /api/onboarding")!.body,
    ).toMatchObject({
      full_name: "Ada Lovelace",
    });
  });

  it("is not sent when it was already known", async () => {
    const calls = api();
    renderApp(<App />, "/onboarding");
    await walk();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: /You're all set/ });
    expect(
      calls.find((c) => c.key === "PUT /api/onboarding")!.body,
    ).not.toHaveProperty("full_name");
  });
});

describe("finishing", () => {
  it("saves all four answers and the role, then shows a personal plan", async () => {
    const calls = api();
    renderApp(<App />, "/onboarding");
    await walk();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      await screen.findByRole("heading", { name: /You're all set, Jordan/ }),
    ).toBeInTheDocument();
    const put = calls.find((c) => c.key === "PUT /api/onboarding")!;
    expect(put.body).toEqual({
      ...ANSWERS,
      help: ["interviews"], // the job-search questions were not asked, so none are sent
      arrangement: [],
      role: "Senior Product Manager",
      skipped: false,
    });
    expect(put.headers.get("x-requested-with")).toBe("meet-practice");
    expect(screen.getByText(PLAN.few_weeks)).toBeInTheDocument();
    expect(
      screen.getByText(/Structuring my answers · Backing claims with results/),
    ).toBeInTheDocument();
  });

  it("points to the three next steps and the dashboard", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await walk();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: /You're all set/ });
    const hrefs = (n: string) =>
      screen.getByRole("link", { name: new RegExp(n) }).getAttribute("href");
    expect(hrefs("Upload your CV")).toBe("/settings/cv");
    expect(hrefs("Add a company")).toBe("/companies");
    expect(hrefs("Start an interview")).toBe("/session/new");
    expect(hrefs("Go to your dashboard")).toBe("/dashboard");
  });

  it.each(Object.entries(PLAN))(
    "gives advice that matches the timeline (%s)",
    async (key, text) => {
      api();
      renderApp(<App />, "/onboarding");
      await screen.findByRole("heading", { name: STEPS[0].title });
      await pick(/A new job/);
      await next();
      await pick(/Senior/);
      await next();
      await userEvent.click(
        screen.getByRole("radio", {
          name: new RegExp(TIMELINES[key as keyof typeof TIMELINES].label),
        }),
      );
      await next();
      await userEvent.click(screen.getAllByRole("checkbox")[0]);
      await practise();
      await userEvent.click(screen.getByRole("button", { name: "Finish" }));
      expect(await screen.findByText(text)).toBeInTheDocument();
    },
  );

  it("omits the role when none was typed", async () => {
    const calls = api();
    renderApp(<App />, "/onboarding");
    await screen.findByRole("heading", { name: STEPS[0].title });
    await pick(/A new job/);
    await next();
    await pick(/Senior/);
    await next();
    await pick(/In the next few weeks/);
    await next();
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    await practise();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: /You're all set/ });
    expect(
      calls.find((c) => c.key === "PUT /api/onboarding")!.body,
    ).not.toHaveProperty("role");
  });

  it("shows an error and stays on the last step if saving fails", async () => {
    api(NAMED, {
      "PUT /api/onboarding": () => ({
        status: 500,
        json: {
          error: {
            code: "server_error",
            message: "Something went wrong.",
            request_id: "r",
          },
        },
      }),
    });
    renderApp(<App />, "/onboarding");
    await walk();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/went wrong/i);
    expect(
      screen.getByRole("heading", { name: STEPS[4].title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled();
  });
});

describe("skipping", () => {
  it("can be done from any step, keeps what was answered, and goes to the dashboard", async () => {
    const calls = api();
    renderApp(<App />, "/onboarding");
    await screen.findByRole("heading", { name: STEPS[0].title });
    await pick(/A promotion/);
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    const put = calls.find((c) => c.key === "PUT /api/onboarding")!;
    expect(put.body).toMatchObject({ skipped: true, goal: "promotion" });
  });

  it("works with nothing answered at all", async () => {
    const calls = api();
    renderApp(<App />, "/onboarding");
    await userEvent.click(
      await screen.findByRole("button", { name: "Skip for now" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(
      calls.find((c) => c.key === "PUT /api/onboarding")!.body,
    ).toMatchObject({ skipped: true });
  });

  it("is not offered on the final screen", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await walk();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: /You're all set/ });
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
  });
});

describe("the questions and answers", () => {
  it("are seven steps, each with a title and a reason for asking", () => {
    expect(STEPS).toHaveLength(7);
    for (const s of STEPS) {
      expect(s.title.endsWith("?") || s.title.length > 10).toBe(true);
      expect(s.why.length).toBeGreaterThan(10);
    }
  });

  it("give every answer an emoji, a label and a hint, with no repeats", () => {
    for (const table of [
      GOALS,
      LEVELS,
      TIMELINES,
      FOCUS,
      HELPS,
      SEARCHES,
      ARRANGEMENTS,
    ]) {
      const rows = entries(table as never) as {
        value: string;
        emoji: string;
        label: string;
        hint: string;
      }[];
      expect(new Set(rows.map((r) => r.value)).size).toBe(rows.length);
      expect(new Set(rows.map((r) => r.label)).size).toBe(rows.length);
      for (const r of rows) expect(r.emoji && r.label && r.hint).toBeTruthy();
    }
    expect(Object.keys(GOALS)).toHaveLength(4);
    expect(Object.keys(LEVELS)).toHaveLength(4);
    expect(Object.keys(TIMELINES)).toHaveLength(4);
    expect(Object.keys(FOCUS)).toHaveLength(6);
    expect(MAX_FOCUS).toBe(3);
  });

  it("have a plan for every timeline", () => {
    expect(Object.keys(PLAN).sort()).toEqual(Object.keys(TIMELINES).sort());
  });

  it("show their emoji as decoration, not as part of the answer's name", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await screen.findByRole("heading", { name: STEPS[0].title });
    expect(
      screen
        .getByRole("radio", { name: /A new job/ })
        .closest("label")!
        .querySelector("[aria-hidden=true]"),
    ).not.toBeNull();
  });
});

describe("the job-search side", () => {
  /** On the help question, having walked the four interview questions. */
  async function toHelp() {
    await walk(4);
    await next();
    await screen.findByRole("heading", { name: STEPS[4].title });
  }

  it("asks what else they want help with, and ends there for someone who only practises", async () => {
    api();
    renderApp(<App />, "/onboarding");
    await toHelp();
    expect(screen.getByText("Step 5 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled(); // one is needed
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Practise interviews/ }),
    );
    expect(screen.getByRole("button", { name: "Finish" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("adds two questions, how soon and how they want to work, when they want Auto-Apply", async () => {
    const calls = api();
    renderApp(<App />, "/onboarding");
    await toHelp();
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Find and apply to jobs for me/ }),
    );
    expect(screen.getByText("Step 5 of 7")).toBeInTheDocument(); // the others are now counted
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    await next();
    await screen.findByRole("heading", { name: STEPS[5].title });
    expect(screen.getByText("Step 6 of 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await pick(/Right now/);
    await next();
    await screen.findByRole("heading", { name: STEPS[6].title });
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /Remote/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Hybrid/ }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: /You're all set/ });
    expect(
      calls.find((c) => c.key === "PUT /api/onboarding")!.body,
    ).toMatchObject({
      help: ["auto_apply"],
      search: "now",
      arrangement: ["remote", "hybrid"],
      skipped: false,
    });
    // the next steps follow what they asked for: Auto-Apply first, no mock-interview plan
    const links = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    expect(links).toContain("/auto-apply/setup");
    expect(links).not.toContain("/session/new");
    expect(screen.queryByText(/We'll keep in view/)).toBeNull();
  });

  it("sends startup outreach and interviews together, and points to each", async () => {
    const calls = api();
    renderApp(<App />, "/onboarding");
    await toHelp();
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Reach out to startups/ }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Practise interviews/ }),
    );
    await next();
    await pick(/Later, just exploring/);
    await next();
    await userEvent.click(screen.getByRole("checkbox", { name: /On-site/ }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: /You're all set/ });
    expect(
      calls.find((c) => c.key === "PUT /api/onboarding")!.body,
    ).toMatchObject({
      help: ["startups", "interviews"],
      search: "later",
      arrangement: ["onsite"],
    });
    const links = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    expect(links).toEqual(
      expect.arrayContaining(["/startups", "/session/new", "/companies"]),
    );
  });

  it("does not send a job-search answer to someone who did not ask for that help", async () => {
    const calls = api();
    renderApp(<App />, "/onboarding");
    await toHelp();
    // choose job help, answer, then change their mind
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Find and apply to jobs for me/ }),
    );
    await next();
    await pick(/Right now/);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Find and apply to jobs for me/ }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Practise interviews/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: /You're all set/ });
    const body = calls.find((c) => c.key === "PUT /api/onboarding")!
      .body as Record<string, unknown>;
    expect(body.help).toEqual(["interviews"]);
    expect(body.search).toBeUndefined();
    expect(body.arrangement).toEqual([]);
  });
});
