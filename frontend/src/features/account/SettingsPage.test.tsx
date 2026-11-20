import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

describe("SettingsPage", () => {
  it("states the practice-only, consent and third-party terms", async () => {
    mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings");
    expect(
      await screen.findByText(/partner who knows the assistant is on/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/processed by OpenAI/i)).toBeInTheDocument();
    expect(
      screen.getByText(/discarded. Only text is saved/i),
    ).toBeInTheDocument();
  });

  it("asks for confirmation before deleting, then deletes and leaves the app", async () => {
    let deleted = false;
    const calls = mockApi({
      "GET /api/me": () => (deleted ? UNAUTH : { json: ME }),
      "DELETE /api/account": () => {
        deleted = true;
        return { status: 202, json: { status: "accepted" } };
      },
    });
    renderApp(<App />, "/settings");
    await userEvent.click(
      await screen.findByRole("button", { name: /delete my account/i }),
    );
    expect(calls.some((c) => c.key === "DELETE /api/account")).toBe(false); // not yet
    await userEvent.click(
      screen.getByRole("button", { name: /yes, delete everything/i }),
    );
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    const del = calls.find((c) => c.key === "DELETE /api/account")!;
    expect(del.headers.get("x-requested-with")).toBe("meet-practice");
  });

  it("lets the user cancel", async () => {
    const calls = mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings");
    await userEvent.click(
      await screen.findByRole("button", { name: /delete my account/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: /delete my account/i }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key === "DELETE /api/account")).toBe(false);
  });
});

describe("SettingsPage: your name", () => {
  it("shows the saved name and only lets it be saved once it has changed", async () => {
    mockApi({
      "GET /api/me": () => ({ json: { ...ME, full_name: "Jordan Reyes" } }),
    });
    renderApp(<App />, "/settings");
    const field = await screen.findByLabelText("Full name");
    expect(field).toHaveValue("Jordan Reyes");
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    await userEvent.type(field, "x");
    expect(screen.getByRole("button", { name: "Save name" })).toBeEnabled();
    await userEvent.clear(field);
    await userEvent.type(field, "J");
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled(); // too short
  });

  it("saves the trimmed name and the greeting follows", async () => {
    let me: object = { ...ME, full_name: "Jordan Reyes" };
    const calls = mockApi({
      "GET /api/me": () => ({ json: me }),
      "PUT /api/profile": ({ body }) => {
        me = { ...ME, full_name: (body as { full_name: string }).full_name };
        return { json: me };
      },
    });
    renderApp(<App />, "/settings");
    const field = await screen.findByLabelText("Full name");
    await userEvent.clear(field);
    await userEvent.type(field, "  Ada Lovelace ");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(calls.find((c) => c.key === "PUT /api/profile")!.body).toEqual({
      full_name: "Ada Lovelace",
    });
    expect(screen.getByLabelText("Full name")).toHaveValue("Ada Lovelace");
  });

  it("shows the server's message when the name is refused", async () => {
    mockApi({
      "GET /api/me": () => ({ json: { ...ME, full_name: "Jordan Reyes" } }),
      "PUT /api/profile": () => ({
        status: 422,
        json: {
          error: {
            code: "invalid_name",
            message: "Please enter your full name, using letters only.",
            request_id: "r",
          },
        },
      }),
    });
    renderApp(<App />, "/settings");
    const field = await screen.findByLabelText("Full name");
    await userEvent.type(field, "1");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/full name/i);
  });
});

describe("SettingsPage: practice partner consent", () => {
  it("shows it is not asked every time once they agreed, and lets them switch to asking", async () => {
    let me: object = {
      ...ME,
      practice_consent: true,
      consent_each_time: false,
    };
    const calls = mockApi({
      "GET /api/me": () => ({ json: me }),
      "PUT /api/practice-consent": ({ body }) => {
        const ask = (body as { ask_every_time: boolean }).ask_every_time;
        me = { ...ME, practice_consent: !ask, consent_each_time: ask };
        return { json: me };
      },
    });
    renderApp(<App />, "/settings");
    const box = await screen.findByRole("checkbox", {
      name: "Ask me to confirm before every session",
    });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(
      calls.find((c) => c.key === "PUT /api/practice-consent")!.body,
    ).toEqual({ ask_every_time: true });
    await userEvent.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(
      calls.filter((c) => c.key === "PUT /api/practice-consent")[1].body,
    ).toEqual({ ask_every_time: false });
  });

  it("shows the box ticked for someone who has not agreed yet, since they are asked", async () => {
    mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings");
    expect(
      await screen.findByRole("checkbox", {
        name: "Ask me to confirm before every session",
      }),
    ).toBeChecked();
  });
});
