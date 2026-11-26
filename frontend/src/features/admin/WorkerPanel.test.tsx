import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { mockApi, renderApp } from "../../test-utils";
import { WorkerPanel } from "./WorkerPanel";

const worker = {
  mode: "worker",
  by_status: { queued: 12, running: 2, dead: 1, done: 40 },
  oldest_due_seconds: 900,
  kinds: [
    {
      kind: "autoapply.prepare",
      tasks: 30,
      run_seconds: 600,
      dead: 0,
      queued: 10,
    },
  ],
  dead: [
    {
      id: "t1",
      kind: "mailbox.sync",
      attempts: 3,
      error_class: "AdapterError",
      last_error: "Gmail refused the password",
      finished_at: "2026-11-26T10:00:00Z",
    },
  ],
};

describe("back office: background work", () => {
  it("shows the backlog, says when it is falling behind, and retries a task that gave up", async () => {
    const retry = vi.fn(() => ({ json: { status: "queued" } }));
    mockApi({
      "GET /api/admin/worker": () => ({ json: worker }),
      "POST /api/admin/worker/tasks/t1/retry": retry,
    });
    renderApp(<WorkerPanel />, "/admin/auto-apply");
    const box = within(await screen.findByLabelText("Background queue"));
    expect(box.getByText("12")).toBeInTheDocument();
    expect(box.getByText(/falling behind/)).toBeInTheDocument();
    expect(screen.getByText("Runs in the worker")).toBeInTheDocument();
    const dead = within(
      screen.getByRole("table", { name: "Tasks that gave up" }),
    );
    expect(dead.getByText(/Gmail refused the password/)).toBeInTheDocument();
    await userEvent.click(dead.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(retry).toHaveBeenCalled());
  });
});
