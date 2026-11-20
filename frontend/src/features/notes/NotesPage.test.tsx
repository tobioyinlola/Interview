import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";
import { MAX_CV_BYTES, checkCvFile } from "./NotesPage";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const EMPTY = { role: "", content: "", updated_at: null };
const WITH_CV = {
  role: "PM",
  content: "Jordan Reyes\nLed the payments migration at Northfield.",
  updated_at: "2026-11-17T10:00:00Z",
  cv_filename: "Jordan Reyes CV.pdf",
  cv_uploaded_at: "2026-11-17T10:00:00Z",
};
const pdf = (name = "My CV.pdf", bytes = 2000) =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
const apiError = (status: number, code: string, message: string) => ({
  status,
  json: { error: { code, message, request_id: "r" } },
});
const fileInput = () => screen.getByLabelText("CV file") as HTMLInputElement;

const api = (notes: object, extra: Record<string, (a: never) => object> = {}) =>
  mockApi({
    "GET /api/me": () => ({ json: ME }),
    "GET /api/notes": () => ({ json: notes }),
    ...(extra as Record<string, () => object>),
  });

describe("CV page: nothing uploaded yet", () => {
  it("offers an upload and no box to type notes into", async () => {
    api(EMPTY);
    renderApp(<App />, "/notes");
    expect(
      await screen.findByRole("heading", { name: "Your CV" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Upload your CV" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Choose a file" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/PDF or Word \(\.docx\), up to 5 MB/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /notes/i })).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("only accepts CV file types in the picker", async () => {
    api(EMPTY);
    renderApp(<App />, "/notes");
    await screen.findByRole("heading", { name: "Your CV" });
    const accept = fileInput().getAttribute("accept") ?? "";
    expect(accept).toContain(".pdf");
    expect(accept).toContain(".docx");
  });

  it("opens the file picker from the button", async () => {
    api(EMPTY);
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    renderApp(<App />, "/notes");
    await userEvent.click(
      await screen.findByRole("button", { name: "Choose a file" }),
    );
    expect(click).toHaveBeenCalled();
  });
});

describe("uploading", () => {
  it("sends the file as the request body with its name, then shows what was read", async () => {
    let saved: object = EMPTY;
    const calls = api(EMPTY, {
      "POST /api/notes/cv": () => {
        saved = { ...WITH_CV, truncated: false };
        return { json: saved };
      },
    });
    renderApp(<App />, "/notes");
    await screen.findByRole("heading", { name: "Upload your CV" });
    await userEvent.upload(fileInput(), pdf("Jordan Reyes CV.pdf"));
    expect(
      await screen.findByRole("heading", { name: "Jordan Reyes CV.pdf" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/characters read/)).toBeInTheDocument();
    const sent = calls.find((c) => c.key === "POST /api/notes/cv")!;
    expect(sent.body).toBeInstanceOf(File);
    expect((sent.body as File).name).toBe("Jordan Reyes CV.pdf");
    expect(sent.headers.get("x-filename")).toBe("Jordan%20Reyes%20CV.pdf");
    expect(sent.headers.get("content-type")).toBe("application/pdf");
    expect(sent.headers.get("x-requested-with")).toBe("meet-practice");
    // nothing is typed or saved as text
    expect(calls.some((c) => c.key === "PUT /api/notes")).toBe(false);
  });

  it("lets the person check what was read", async () => {
    api(WITH_CV);
    renderApp(<App />, "/notes");
    const details = (await screen.findByText("See what we read")).closest(
      "details",
    )!;
    expect(
      within(details).getByText(/Led the payments migration at Northfield/),
    ).toBeInTheDocument();
    expect(
      within(details).getByText(
        /Your own experience in an answer can only come from this text/,
      ),
    ).toBeInTheDocument();
  });

  it("says when a very long CV was cut", async () => {
    api(EMPTY, {
      "POST /api/notes/cv": () => ({
        json: { ...WITH_CV, content: "x".repeat(15990), truncated: true },
      }),
    });
    renderApp(<App />, "/notes");
    await screen.findByRole("heading", { name: "Upload your CV" });
    await userEvent.upload(fileInput(), pdf());
    expect(
      await screen.findByText(/kept the first 15,990 characters/),
    ).toBeInTheDocument();
  });

  it("accepts a file dropped on the upload area", async () => {
    const calls = api(EMPTY, {
      "POST /api/notes/cv": () => ({ json: { ...WITH_CV, truncated: false } }),
    });
    renderApp(<App />, "/notes");
    const zone = (
      await screen.findByRole("heading", { name: "Upload your CV" })
    ).closest("section")!;
    fireEvent.drop(zone, { dataTransfer: { files: [pdf("dropped.pdf")] } });
    await waitFor(() =>
      expect(calls.some((c) => c.key === "POST /api/notes/cv")).toBe(true),
    );
    expect(
      (calls.find((c) => c.key === "POST /api/notes/cv")!.body as File).name,
    ).toBe("dropped.pdf");
  });

  it("refuses a file over 5 MB without sending it", async () => {
    const calls = api(EMPTY);
    renderApp(<App />, "/notes");
    await screen.findByRole("heading", { name: "Upload your CV" });
    await userEvent.upload(fileInput(), pdf("big.pdf", MAX_CV_BYTES + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent(/over 5 MB/);
    expect(calls.some((c) => c.key === "POST /api/notes/cv")).toBe(false);
  });

  it("refuses an empty file without sending it", async () => {
    const calls = api(EMPTY);
    renderApp(<App />, "/notes");
    await screen.findByRole("heading", { name: "Upload your CV" });
    await userEvent.upload(fileInput(), pdf("empty.pdf", 0));
    expect(await screen.findByRole("alert")).toHaveTextContent(/empty/);
    expect(calls.some((c) => c.key === "POST /api/notes/cv")).toBe(false);
  });

  it("shows the server's reason when a file cannot be read, and keeps the earlier CV", async () => {
    api(WITH_CV, {
      "POST /api/notes/cv": () =>
        apiError(
          422,
          "cv_no_text",
          "We couldn't find any text in that file. If it's a scan or an image, export a text-based PDF.",
        ),
    });
    renderApp(<App />, "/notes");
    await screen.findByRole("heading", { name: "Jordan Reyes CV.pdf" });
    await userEvent.upload(fileInput(), pdf("scan.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /scan or an image/,
    );
    expect(
      screen.getByRole("heading", { name: "Jordan Reyes CV.pdf" }),
    ).toBeInTheDocument();
  });

  it("shows progress and blocks a second upload while reading", async () => {
    let release: (v: Response) => void = () => {};
    const pending = new Promise<Response>((r) => (release = r));
    const calls = api(EMPTY);
    const original = globalThis.fetch as unknown as (
      u: string,
      i?: RequestInit,
    ) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, i?: RequestInit) =>
        u.endsWith("/api/notes/cv") ? pending : original(u, i),
      ),
    );
    renderApp(<App />, "/notes");
    await screen.findByRole("heading", { name: "Upload your CV" });
    await userEvent.upload(fileInput(), pdf());
    const busy = await screen.findByRole("button", {
      name: "Reading your CV…",
    });
    expect(busy).toBeDisabled();
    release(
      new Response(JSON.stringify({ ...WITH_CV, truncated: false }), {
        status: 200,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Jordan Reyes CV.pdf" }),
    ).toBeInTheDocument();
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("an uploaded CV", () => {
  it("shows its name, when it was uploaded and how much was read", async () => {
    api(WITH_CV);
    renderApp(<App />, "/notes");
    expect(
      await screen.findByRole("heading", { name: "Jordan Reyes CV.pdf" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Uploaded Nov 17, 2026/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${WITH_CV.content.length} characters read`)),
    ).toBeInTheDocument();
  });

  it("replaces the CV by choosing another file", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    const calls = api(WITH_CV, {
      "POST /api/notes/cv": () => ({
        json: {
          ...WITH_CV,
          cv_filename: "New CV.pdf",
          content: "New text",
          truncated: false,
        },
      }),
    });
    renderApp(<App />, "/notes");
    await userEvent.click(
      await screen.findByRole("button", { name: "Replace CV" }),
    );
    expect(click).toHaveBeenCalled();
    await userEvent.upload(fileInput(), pdf("New CV.pdf"));
    expect(
      await screen.findByRole("heading", { name: "New CV.pdf" }),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.key === "POST /api/notes/cv")).toHaveLength(1);
  });

  it("asks before removing, and can be cancelled", async () => {
    const calls = api(WITH_CV);
    renderApp(<App />, "/notes");
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove" }),
    );
    expect(screen.getByText("Remove your CV?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByText("Remove your CV?")).toBeNull();
    expect(calls.some((c) => c.key === "DELETE /api/notes/cv")).toBe(false);
  });

  it("removes the CV and goes back to the upload prompt", async () => {
    const calls = api(WITH_CV, {
      "DELETE /api/notes/cv": () => ({ json: { ...EMPTY, role: "PM" } }),
    });
    renderApp(<App />, "/notes");
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, remove it" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Upload your CV" }),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.key === "DELETE /api/notes/cv")).toHaveLength(
      1,
    );
    expect(screen.getByDisplayValue("PM")).toBeInTheDocument(); // the role stays
  });

  it("explains notes typed before CV uploads existed and says how to replace them", async () => {
    api({ role: "PM", content: "Old typed notes", updated_at: "x" });
    renderApp(<App />, "/notes");
    expect(
      await screen.findByRole("heading", {
        name: "Notes from before CV uploads",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Upload your CV to replace them/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Replace CV" }),
    ).toBeInTheDocument();
  });
});

describe("target role", () => {
  it("loads without saving it back", async () => {
    const calls = api(WITH_CV);
    renderApp(<App />, "/notes");
    expect(await screen.findByDisplayValue("PM")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((c) => c.key === "PUT /api/notes")).toBe(false);
  });

  it("autosaves only the role, never the CV text", async () => {
    const calls = api(EMPTY, {
      "PUT /api/notes": () => ({
        json: { ...EMPTY, role: "Senior PM", updated_at: "now" },
      }),
    });
    renderApp(<App />, "/notes");
    await userEvent.type(
      await screen.findByLabelText("Target role"),
      "Senior PM",
    );
    expect(
      await screen.findByText("Saved", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    const puts = calls.filter((c) => c.key === "PUT /api/notes");
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ role: "Senior PM" });
  });
});

describe("checkCvFile", () => {
  it("rejects empty and over-size files and lets the server judge the rest", () => {
    expect(checkCvFile(pdf("a.pdf", 0))).toMatch(/empty/);
    expect(checkCvFile(pdf("a.pdf", MAX_CV_BYTES + 1))).toMatch(/5 MB/);
    expect(checkCvFile(pdf("a.pdf", MAX_CV_BYTES))).toBeNull();
    expect(checkCvFile(new File(["x"], "cv", { type: "" }))).toBeNull(); // no extension is fine
  });
});
