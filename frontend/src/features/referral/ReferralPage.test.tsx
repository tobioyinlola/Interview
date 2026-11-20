import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../app/App";
import { ME, mockApi, renderApp, stubSupportedBrowser } from "../../test-utils";

beforeEach(() => stubSupportedBrowser());
afterEach(() => vi.restoreAllMocks());

const billing = (over: Record<string, unknown> = {}) => ({
  sessions_available: 1,
  trial_available: true,
  referral_credits_available: 0,
  paid_credits_available: 0,
  payments_enabled: false,
  referral_code: "abc23xyz",
  referral_link: "https://app.example.com/signup?ref=abc23xyz",
  referrals_qualified: 0,
  referrals_per_reward: 3,
  referrals_to_next_reward: 3,
  rewards_earned: 0,
  rewards_redeemable: 0,
  ...over,
});
const open = (b: object, extra: Record<string, () => object> = {}) => {
  const calls = mockApi({
    "GET /api/me": () => ({ json: { ...ME, onboarded: true } }),
    "GET /api/billing": () => ({ json: b }),
    ...extra,
  });
  renderApp(<App />, "/referrals");
  return calls;
};

describe("ReferralPage", () => {
  it("shows the invite link, the rule, and the free trial session", async () => {
    open(billing());
    expect(
      await screen.findByRole("heading", { name: "Invite friends" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Invite link")).toHaveValue(
      "https://app.example.com/signup?ref=abc23xyz",
    );
    expect(screen.getByText(/Invite 3 people who sign up/)).toBeInTheDocument();
    expect(screen.getByText("1 free trial session")).toBeInTheDocument();
    expect(screen.getByText(/pay per session/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Redeem/ })).toBeNull();
  });

  it("shows progress toward the next free session", async () => {
    open(billing({ referrals_qualified: 2, referrals_to_next_reward: 1 }));
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(
      screen.getByText(/2 of 3 toward your next free session/),
    ).toHaveTextContent("1 more to go");
    expect(screen.getByText(/friends have/)).toBeInTheDocument();
  });

  it("copies the link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    open(billing());
    await userEvent.click(
      await screen.findByRole("button", { name: "Copy link" }),
    );
    expect(writeText).toHaveBeenCalledWith(
      "https://app.example.com/signup?ref=abc23xyz",
    );
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("says so when it cannot copy, and the link is still there to copy by hand", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
      configurable: true,
    });
    open(billing());
    await userEvent.click(
      await screen.findByRole("button", { name: "Copy link" }),
    );
    expect(await screen.findByText(/Couldn't copy/)).toBeInTheDocument();
    expect(screen.getByLabelText("Invite link")).toBeInTheDocument();
  });

  it("offers to redeem an earned reward, and redeeming adds a session", async () => {
    let state = billing({
      referrals_qualified: 3,
      rewards_earned: 1,
      rewards_redeemable: 1,
      referrals_to_next_reward: 3,
    });
    const calls = open(state, {
      "GET /api/billing": () => ({ json: state }),
      "POST /api/billing/redeem": () => {
        state = billing({
          sessions_available: 2,
          referral_credits_available: 1,
          referrals_qualified: 3,
          rewards_earned: 1,
          rewards_redeemable: 0,
        });
        return { json: state };
      },
    });
    expect(
      await screen.findByText(/You earned 1 free session/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Redeem free session" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Redeem free session/ }),
      ).toBeNull(),
    );
    expect(calls.some((c) => c.key === "POST /api/billing/redeem")).toBe(true);
    expect(screen.getByText("1 from inviting friends")).toBeInTheDocument();
    expect(
      screen.getByText(/You can start 2 sessions now/),
    ).toBeInTheDocument();
  });

  it("shows the server's message if redeeming fails", async () => {
    open(
      billing({
        rewards_earned: 1,
        rewards_redeemable: 1,
        referrals_qualified: 3,
      }),
      {
        "POST /api/billing/redeem": () => ({
          status: 409,
          json: {
            error: {
              code: "nothing_to_redeem",
              message: "You have no invite reward to redeem yet.",
              request_id: "r",
            },
          },
        }),
      },
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Redeem free session" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no invite reward to redeem",
    );
  });

  it("says there are no sessions left, with no start button", async () => {
    open(billing({ sessions_available: 0, trial_available: false }));
    expect(
      await screen.findByText("You have no free sessions left."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Start a session" })).toBeNull();
  });

  it("is in the sidebar", async () => {
    open(billing());
    const nav = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(nav.getByRole("link", { name: "Invite friends" })).toHaveAttribute(
      "href",
      "/referrals",
    );
  });
});
