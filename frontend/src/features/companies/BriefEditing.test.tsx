import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import type { Brief } from "../../api/types";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";
import { BriefView } from "./BriefView";
import { BRIEF, COMPANY, SOURCES, apiError, detail } from "./fixtures";

const view = (brief: Brief = BRIEF, over = {}) => {
  const onSave = vi.fn();
  render(
    <BriefView
      brief={brief}
      sources={SOURCES}
      editing={{ onSave, pending: false, ...over }}
    />,
  );
  return onSave;
};
const snapshot = () => screen.getByRole("region", { name: "Snapshot" });

describe("BriefView editing", () => {
  it("shows no controls on a read-only brief", () => {
    render(<BriefView brief={BRIEF} sources={SOURCES} />);
    expect(
      screen.queryByRole("button", { name: /pin|edit|delete|add my own/i }),
    ).toBeNull();
  });

  it("pins a fact, sending only that change", async () => {
    const onSave = view();
    await userEvent.click(
      within(snapshot()).getByRole("button", { name: "Pin" }),
    );
    expect(onSave).toHaveBeenCalledWith([
      {
        id: "f1",
        section_key: "snapshot",
        text: "Acme builds payment software.",
        pinned: true,
      },
    ]);
  });

  it("a pinned fact shows Pinned and offers Unpin", async () => {
    const brief = structuredClone(BRIEF);
    brief.sections[0].facts[0].pinned = true;
    const onSave = view(brief);
    expect(within(snapshot()).getByText("Pinned")).toBeInTheDocument();
    const toggle = within(snapshot()).getByRole("button", { name: "Unpin" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ id: "f1", pinned: false }),
    ]);
  });

  it("edits the text and keeps the pin", async () => {
    const brief = structuredClone(BRIEF);
    brief.sections[0].facts[0].pinned = true;
    const onSave = view(brief);
    await userEvent.click(
      within(snapshot()).getByRole("button", { name: /Edit fact/ }),
    );
    const box = screen.getByLabelText("Edit fact");
    expect(box).toHaveValue("Acme builds payment software.");
    await userEvent.clear(box);
    await userEvent.type(box, "Acme builds payments software for cafes.");
    await userEvent.click(screen.getByRole("button", { name: "Save fact" }));
    expect(onSave).toHaveBeenCalledWith([
      {
        id: "f1",
        section_key: "snapshot",
        text: "Acme builds payments software for cafes.",
        pinned: true,
      },
    ]);
  });

  it("cancelling an edit restores the text and sends nothing; an empty fact cannot be saved", async () => {
    const onSave = view();
    await userEvent.click(
      within(snapshot()).getByRole("button", { name: /Edit fact/ }),
    );
    await userEvent.clear(screen.getByLabelText("Edit fact"));
    expect(screen.getByRole("button", { name: "Save fact" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Edit fact"), "temporary");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(
      within(snapshot()).getByText("Acme builds payment software."),
    ).toBeInTheDocument();
    await userEvent.click(
      within(snapshot()).getByRole("button", { name: /Edit fact/ }),
    );
    expect(screen.getByLabelText("Edit fact")).toHaveValue(
      "Acme builds payment software.",
    );
  });

  it("deletes a fact", async () => {
    const onSave = view();
    await userEvent.click(
      within(snapshot()).getByRole("button", { name: /Delete fact/ }),
    );
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ id: "f1", delete: true }),
    ]);
  });

  it("adds the user's own fact to a section, only when it has text", async () => {
    const onSave = view();
    await userEvent.click(
      within(snapshot()).getByRole("button", {
        name: /Add my own fact to Snapshot/,
      }),
    );
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("New fact for Snapshot"),
      "  A mentor works there. ",
    );
    await userEvent.click(add);
    expect(onSave).toHaveBeenCalledWith([
      { section_key: "snapshot", text: "A mentor works there.", pinned: false },
    ]);
    expect(screen.queryByLabelText("New fact for Snapshot")).toBeNull(); // the form closes
  });

  it("even an empty 'Not found' section can take the user's own fact", () => {
    view();
    const s = screen.getByRole("region", { name: "Interview process" });
    expect(within(s).getByText("Not found")).toBeInTheDocument();
    expect(
      within(s).getByRole("button", {
        name: /Add my own fact to Interview process/,
      }),
    ).toBeInTheDocument();
  });

  it("labels the user's own and edited facts", () => {
    const brief = structuredClone(BRIEF);
    brief.sections[0].facts.push(
      {
        id: "mine",
        text: "My own.",
        source_ids: [],
        date: null,
        label: "from_you",
        pinned: false,
        edited_by_user: true,
      },
      {
        id: "edited",
        text: "Reworded.",
        source_ids: ["s1"],
        date: null,
        label: null,
        pinned: false,
        edited_by_user: true,
      },
    );
    view(brief);
    const mine = screen.getByText("My own.").closest("li")!;
    expect(within(mine).getByText("From you")).toBeInTheDocument();
    expect(within(mine).queryByText("Edited")).toBeNull();
    expect(
      within(screen.getByText("Reworded.").closest("li")!).getByText("Edited"),
    ).toBeInTheDocument();
  });

  it("disables pinning and deleting while a save is in flight, and shows a save error", () => {
    view(BRIEF, {
      pending: true,
      error: "That section is full. Remove a fact first.",
    });
    expect(
      within(snapshot()).getByRole("button", { name: "Pin" }),
    ).toBeDisabled();
    expect(
      within(snapshot()).getByRole("button", { name: /Delete fact/ }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That section is full.",
    );
  });
});

describe("CompanyPage brief editing", () => {
  beforeEach(() => stubSupportedBrowser());
  afterEach(() => vi.restoreAllMocks());
  const me = { "GET /api/me": () => ({ json: ME }) };

  it("pins through the API and shows the result", async () => {
    let pinned = false;
    const calls = mockApi({
      ...me,
      "GET /api/companies/c1": () => {
        const d = structuredClone(detail());
        d.brief!.sections[0].facts[0].pinned = pinned;
        return { json: d };
      },
      "PUT /api/companies/c1/brief": () => {
        pinned = true;
        return { json: { brief: BRIEF, brief_version: 1 } };
      },
    });
    renderApp(<App />, "/companies/c1");
    const sec = await screen.findByRole("region", { name: "Snapshot" });
    await userEvent.click(within(sec).getByRole("button", { name: "Pin" }));
    expect(await within(sec).findByText("Pinned")).toBeInTheDocument();
    const put = calls.find((c) => c.key === "PUT /api/companies/c1/brief")!;
    expect(put.body).toEqual({
      facts: [
        {
          id: "f1",
          section_key: "snapshot",
          text: "Acme builds payment software.",
          pinned: true,
        },
      ],
    });
    expect(put.headers.get("x-requested-with")).toBe("meet-practice");
  });

  it("shows the server's reason when an edit is refused", async () => {
    mockApi({
      ...me,
      "GET /api/companies/c1": () => ({ json: detail({ company: COMPANY }) }),
      "PUT /api/companies/c1/brief": () =>
        apiError(
          422,
          "too_many_facts",
          "That section is full. Remove a fact first.",
        ),
    });
    renderApp(<App />, "/companies/c1");
    const sec = await screen.findByRole("region", { name: "Snapshot" });
    await userEvent.click(
      within(sec).getByRole("button", { name: /Delete fact/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That section is full.",
    );
  });
});
