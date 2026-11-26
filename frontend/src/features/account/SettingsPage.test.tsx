import { screen, within } from "@testing-library/react";
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

const notes = (over: object = {}) => ({
  role: "Product manager",
  content: "A CV",
  cv_filename: "ada.pdf",
  cv_uploaded_at: "2026-11-01T10:00:00Z",
  updated_at: null,
  ...over,
});
const apiError = (status: number, code: string, message: string) => ({
  status,
  json: { error: { code, message, request_id: "r" } },
});

describe("Settings: the tabs", () => {
  it("opens on Profile and offers Profile, Password, CV, Email and Privacy and data", async () => {
    mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings");
    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
    const tabs = within(
      screen.getByRole("navigation", { name: "Settings sections" }),
    );
    for (const name of [
      "Profile",
      "Password",
      "CV",
      "Email",
      "Privacy and data",
    ])
      expect(tabs.getByRole("link", { name })).toBeInTheDocument();
    expect(tabs.getByRole("link", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("switches between tabs and an unknown tab goes to Profile", async () => {
    mockApi({
      "GET /api/me": () => ({ json: ME }),
      "GET /api/notes": () => ({ json: notes() }),
    });
    renderApp(<App />, "/settings/nope");
    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Password" }));
    expect(
      await screen.findByRole("heading", { name: "Set a password" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "CV" }));
    expect(
      await screen.findByRole("heading", { name: "Your CV" }),
    ).toBeInTheDocument();
  });

  it("keeps the old /notes address working by sending it to the CV tab", async () => {
    mockApi({
      "GET /api/me": () => ({ json: ME }),
      "GET /api/notes": () => ({ json: notes() }),
    });
    renderApp(<App />, "/notes");
    expect(
      await screen.findByRole("heading", { name: "Your CV" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CV" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("Settings: profile", () => {
  const me = {
    ...ME,
    full_name: "Jordan Reyes",
    phone: "+234 801 234 5678",
    location: "Lagos, Nigeria",
    headline: null,
    linkedin_url: null,
    has_password: true,
  };

  it("shows the saved bio data, with the email read-only", async () => {
    mockApi({ "GET /api/me": () => ({ json: me }) });
    renderApp(<App />, "/settings/profile");
    expect(await screen.findByLabelText("Full name")).toHaveValue(
      "Jordan Reyes",
    );
    expect(screen.getByLabelText("Phone number")).toHaveValue(
      "+234 801 234 5678",
    );
    expect(screen.getByLabelText("City or town")).toHaveValue("Lagos");
    expect(screen.getByLabelText("Country")).toHaveValue("Nigeria");
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveValue("me@example.com");
    expect(email).toHaveAttribute("readonly");
  });

  it("only lets it be saved once something changed, and the name must be real", async () => {
    mockApi({ "GET /api/me": () => ({ json: me }) });
    renderApp(<App />, "/settings/profile");
    const save = await screen.findByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("What you do"), "PM");
    expect(save).toBeEnabled();
    const name = screen.getByLabelText("Full name");
    await userEvent.clear(name);
    await userEvent.type(name, "J");
    expect(save).toBeDisabled(); // too short
  });

  it("saves everything trimmed, and shows it as the server tidied it", async () => {
    let current: object = me;
    const calls = mockApi({
      "GET /api/me": () => ({ json: current }),
      "PUT /api/profile": ({ body }) => {
        const b = body as Record<string, string>;
        current = {
          ...me,
          full_name: b.full_name,
          phone: "+234 801 234 5678",
          headline: b.headline,
          linkedin_url: "https://linkedin.com/in/ada",
        };
        return { json: current };
      },
    });
    renderApp(<App />, "/settings/profile");
    const name = await screen.findByLabelText("Full name");
    await userEvent.selectOptions(screen.getByLabelText("Country"), "Kenya");
    await userEvent.clear(screen.getByLabelText("City or town"));
    await userEvent.type(screen.getByLabelText("City or town"), "Nairobi");
    await userEvent.clear(name);
    await userEvent.type(name, "  Ada Lovelace ");
    await userEvent.type(
      screen.getByLabelText("What you do"),
      " Product manager ",
    );
    await userEvent.type(
      screen.getByLabelText("LinkedIn or portfolio link"),
      "linkedin.com/in/ada",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(calls.find((c) => c.key === "PUT /api/profile")!.body).toEqual({
      full_name: "Ada Lovelace",
      phone: "+234 801 234 5678",
      location: "Nairobi, Kenya",
      headline: "Product manager",
      linkedin_url: "linkedin.com/in/ada",
    });
    expect(screen.getByLabelText("LinkedIn or portfolio link")).toHaveValue(
      "https://linkedin.com/in/ada",
    );
  });

  it("shows the server's message when something is refused", async () => {
    mockApi({
      "GET /api/me": () => ({ json: me }),
      "PUT /api/profile": () =>
        apiError(
          422,
          "invalid_profile",
          "Enter a phone number with 7 to 15 digits.",
        ),
    });
    renderApp(<App />, "/settings/profile");
    await userEvent.type(await screen.findByLabelText("Phone number"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/phone number/i);
  });
});

describe("Settings: countries and roles are picked from lists", () => {
  it("offers every country in a dropdown and common roles as suggestions", async () => {
    mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings/profile");
    const country = await screen.findByLabelText("Country");
    expect(country.tagName).toBe("SELECT");
    const names = within(country)
      .getAllByRole("option")
      .map((o) => o.textContent);
    for (const c of [
      "Nigeria",
      "Ghana",
      "Kenya",
      "United Kingdom",
      "United States",
      "South Africa",
      "India",
    ])
      expect(names).toContain(c);
    expect(names.length).toBeGreaterThan(195);
    const role = screen.getByLabelText("What you do") as HTMLInputElement;
    const list = document.getElementById(role.getAttribute("list")!)!;
    const roles = [...list.querySelectorAll("option")].map((o) =>
      o.getAttribute("value"),
    );
    for (const r of [
      "Product Manager",
      "Software Engineer",
      "Data Analyst",
      "UX Designer",
    ])
      expect(roles).toContain(r);
  });

  it("keeps a place that is not 'City, Country' as the city", async () => {
    mockApi({
      "GET /api/me": () => ({ json: { ...ME, location: "Somewhere remote" } }),
    });
    renderApp(<App />, "/settings/profile");
    expect(await screen.findByLabelText("City or town")).toHaveValue(
      "Somewhere remote",
    );
    expect(screen.getByLabelText("Country")).toHaveValue("");
  });

  it("uses the same role list for the target role on the CV tab", async () => {
    mockApi({
      "GET /api/me": () => ({ json: ME }),
      "GET /api/notes": () => ({ json: notes() }),
    });
    renderApp(<App />, "/settings/cv");
    const role = (await screen.findByLabelText(
      "Target role",
    )) as HTMLInputElement;
    expect(role.getAttribute("list")).toBeTruthy();
    expect(
      document
        .getElementById(role.getAttribute("list")!)!
        .querySelectorAll("option").length,
    ).toBeGreaterThan(80);
  });
});

describe("Settings: password", () => {
  it("changes a password with the current one, then clears the form", async () => {
    const calls = mockApi({
      "GET /api/me": () => ({ json: { ...ME, has_password: true } }),
      "PUT /api/account/password": () => ({
        json: { ...ME, has_password: true },
      }),
    });
    renderApp(<App />, "/settings/password");
    expect(
      await screen.findByRole("heading", { name: "Change your password" }),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Current password"),
      "old passphrase here",
    );
    await userEvent.type(
      screen.getByLabelText("New password"),
      "a brand new passphrase!",
    );
    await userEvent.type(
      screen.getByLabelText("Repeat the new password"),
      "a brand new passphrase!",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Change password" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Password saved",
    );
    expect(
      calls.find((c) => c.key === "PUT /api/account/password")!.body,
    ).toEqual({
      current_password: "old passphrase here",
      new_password: "a brand new passphrase!",
    });
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });

  it("sets a first password for someone who signs in by email or Google, with no current one", async () => {
    const calls = mockApi({
      "GET /api/me": () => ({ json: { ...ME, has_password: false } }),
      "PUT /api/account/password": () => ({
        json: { ...ME, has_password: true },
      }),
    });
    renderApp(<App />, "/settings/password");
    expect(
      await screen.findByRole("heading", { name: "Set a password" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).toBeNull();
    await userEvent.type(
      screen.getByLabelText("New password"),
      "a brand new passphrase!",
    );
    await userEvent.type(
      screen.getByLabelText("Repeat the new password"),
      "a brand new passphrase!",
    );
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    await screen.findByRole("status");
    expect(
      calls.find((c) => c.key === "PUT /api/account/password")!.body,
    ).toEqual({
      new_password: "a brand new passphrase!",
    });
  });

  it("will not send two different new passwords", async () => {
    const calls = mockApi({
      "GET /api/me": () => ({ json: { ...ME, has_password: false } }),
    });
    renderApp(<App />, "/settings/password");
    await userEvent.type(
      await screen.findByLabelText("New password"),
      "a brand new passphrase!",
    );
    await userEvent.type(
      screen.getByLabelText("Repeat the new password"),
      "something else entirely",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("not the same");
    expect(screen.getByRole("button", { name: "Set password" })).toBeDisabled();
    expect(calls.some((c) => c.key.startsWith("PUT"))).toBe(false);
  });

  it("says plainly when the current password is wrong", async () => {
    mockApi({
      "GET /api/me": () => ({ json: { ...ME, has_password: true } }),
      "PUT /api/account/password": () =>
        apiError(401, "wrong_password", "Your current password is not right."),
    });
    renderApp(<App />, "/settings/password");
    await userEvent.type(
      await screen.findByLabelText("Current password"),
      "nope nope nope",
    );
    await userEvent.type(
      screen.getByLabelText("New password"),
      "a brand new passphrase!",
    );
    await userEvent.type(
      screen.getByLabelText("Repeat the new password"),
      "a brand new passphrase!",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Change password" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "current password is not right",
    );
  });
});

describe("Settings: CV", () => {
  it("has the CV and target role here, not in the menu", async () => {
    mockApi({
      "GET /api/me": () => ({ json: ME }),
      "GET /api/notes": () => ({ json: notes() }),
    });
    renderApp(<App />, "/settings/cv");
    expect(await screen.findByText("ada.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Target role")).toHaveValue("Product manager");
    expect(
      screen.getByRole("button", { name: "Replace CV" }),
    ).toBeInTheDocument();
  });
});

describe("Settings: privacy and data", () => {
  it("states the practice-only and third-party terms", async () => {
    mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings/privacy");
    expect(
      await screen.findByText(
        /Everyone on a call must know the assistant is on/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/processed by OpenAI/i)).toBeInTheDocument();
    expect(
      screen.getByText(/discarded. Only text is saved/i),
    ).toBeInTheDocument();
  });

  it("says honestly what this device can do about screen capture, with the two switches", async () => {
    mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings/privacy");
    expect(
      await screen.findByText(
        /A browser cannot keep a page out of screen capture/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Live interview screens are never hidden/),
    ).toBeInTheDocument();
    // a browser has no native protection: only Presentation mode is offered
    expect(screen.queryByLabelText("Protect private screens")).toBeNull();
    await userEvent.click(screen.getByLabelText(/Presentation mode/));
    await userEvent.click(screen.getByRole("link", { name: "Profile" }));
    expect(
      await screen.findByText("Private details hidden"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("link", { name: "Privacy and data" }),
    );
    await userEvent.click(await screen.findByLabelText(/Presentation mode/));
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
    renderApp(<App />, "/settings/privacy");
    await userEvent.click(
      await screen.findByRole("button", { name: /delete my account/i }),
    );
    expect(calls.some((c) => c.key === "DELETE /api/account")).toBe(false);
    await userEvent.click(
      screen.getByRole("button", { name: /yes, delete everything/i }),
    );
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      calls
        .find((c) => c.key === "DELETE /api/account")!
        .headers.get("x-requested-with"),
    ).toBe("meet-practice");
  });

  it("lets the user cancel", async () => {
    const calls = mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings/privacy");
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

describe("Settings: usage statistics", () => {
  it("is on by default, says what it never includes, and turning it off is saved to the account", async () => {
    let off = false;
    const calls = mockApi({
      "GET /api/me": () => ({ json: { ...ME, analytics_opt_out: off } }),
      "PUT /api/analytics/preference": () => {
        off = true;
        return { json: { opt_out: true } };
      },
    });
    renderApp(<App />, "/settings/privacy");
    const box = await screen.findByRole("checkbox", {
      name: /share usage statistics/i,
    });
    expect(box).toBeChecked();
    expect(
      screen.getByText(/never includes what you type, say, upload or see/i),
    ).toBeInTheDocument();
    await userEvent.click(box);
    expect(
      calls.find((c) => c.key === "PUT /api/analytics/preference")!.body,
    ).toEqual({ opt_out: true });
    expect(
      await screen.findByText(/nothing is collected on any of your devices/i),
    ).toBeInTheDocument();
    expect(box).not.toBeChecked();
    expect(localStorage.getItem("im-analytics-off")).toBe("1");
  });

  it("says so when the browser already asks not to be tracked", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    mockApi({ "GET /api/me": () => ({ json: ME }) });
    renderApp(<App />, "/settings/privacy");
    expect(
      await screen.findByText(/browser asks not to be tracked/i),
    ).toBeInTheDocument();
    delete (navigator as unknown as Record<string, unknown>)
      .globalPrivacyControl;
  });
});
