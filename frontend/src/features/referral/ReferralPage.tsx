import { useState } from "react";
import { Link } from "react-router-dom";

import { useBilling, useRedeemReward } from "../../api/hooks";
import { Loading } from "../../ui/Loading";

/** Invite friends: your link, how many have joined, and the free session it earns. */
export function ReferralPage() {
  const billing = useBilling();
  const redeem = useRedeemReward();
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  if (billing.isPending) return <Loading />;
  if (billing.isError)
    return (
      <main className="page-narrow">
        <p role="alert" className="notice-error">
          {billing.error.message}
        </p>
      </main>
    );
  const b = billing.data;
  // A full set that is still waiting to be redeemed shows as full, not as a bar that started over.
  const set = b.referrals_qualified % b.referrals_per_reward;
  const waiting = b.rewards_redeemable > 0 && set === 0;
  const done = waiting ? b.referrals_per_reward : set;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(b.referral_link);
      setCopied("yes");
    } catch {
      setCopied("no"); // the link is in the box: they can copy it by hand
    }
  };

  return (
    <main className="page-narrow">
      <h1 className="text-3xl font-semibold tracking-tight">Invite friends</h1>
      <p className="text-sm text-muted">
        Everyone gets one free interview session. Invite{" "}
        {b.referrals_per_reward} people who sign up with your link and you earn
        another free session.
      </p>

      <section aria-labelledby="link-h" className="card space-y-3">
        <h2 id="link-h" className="text-lg font-semibold">
          Your invite link
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            aria-label="Invite link"
            value={b.referral_link}
            onFocus={(e) => e.currentTarget.select()}
            className="input w-full"
          />
          <button type="button" className="btn-primary shrink-0" onClick={copy}>
            Copy link
          </button>
        </div>
        <p role="status" className="min-h-[1.25rem] text-sm text-muted">
          {copied === "yes" && "Link copied."}
          {copied === "no" && "Couldn't copy. Select the link and copy it."}
        </p>
      </section>

      <section aria-labelledby="prog-h" className="card space-y-3">
        <h2 id="prog-h" className="text-lg font-semibold">
          Your progress
        </h2>
        <p>
          <span className="text-3xl font-semibold">
            {b.referrals_qualified}
          </span>{" "}
          <span className="text-muted">
            {b.referrals_qualified === 1 ? "friend has" : "friends have"} signed
            up
          </span>
        </p>
        <div
          role="progressbar"
          aria-label="Friends toward your next free session"
          aria-valuemin={0}
          aria-valuemax={b.referrals_per_reward}
          aria-valuenow={done}
          className="h-3 w-full overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${(done / b.referrals_per_reward) * 100}%` }}
          />
        </div>
        <p className="text-sm text-muted">
          {waiting
            ? `${done} of ${b.referrals_per_reward}: you earned a free session.`
            : `${done} of ${b.referrals_per_reward} toward your next free session${
                b.referrals_to_next_reward < b.referrals_per_reward
                  ? `: ${b.referrals_to_next_reward} more to go`
                  : ""
              }.`}
        </p>

        {b.referrals_held > 0 && (
          <p
            role="note"
            className="rounded-xl bg-canvas p-3 text-sm text-muted"
          >
            {b.referrals_held === 1
              ? "1 sign-up didn't count"
              : `${b.referrals_held} sign-ups didn't count`}{" "}
            because {b.referrals_held === 1 ? "it looked" : "they looked"} like
            the same device or person as you. If that's a mistake, for example
            you share a computer with a friend, contact support.
          </p>
        )}

        {b.rewards_redeemable > 0 ? (
          <div className="rounded-xl bg-accent-soft p-4">
            <p className="font-medium">
              You earned {b.rewards_redeemable} free{" "}
              {b.rewards_redeemable === 1 ? "session" : "sessions"} 🎉
            </p>
            <p className="mt-1 text-sm text-muted">
              Redeem it to add it to your account. You can use it whenever you
              like.
            </p>
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={redeem.isPending}
              onClick={() => redeem.mutate()}
            >
              {redeem.isPending ? "Redeeming…" : "Redeem free session"}
            </button>
            {redeem.isError && (
              <p role="alert" className="notice-error mt-3">
                {redeem.error.message}
              </p>
            )}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="have-h" className="card space-y-1">
        <h2 id="have-h" className="text-lg font-semibold">
          Your sessions
        </h2>
        <p className="text-sm">
          {b.sessions_available === 0
            ? "You have no free sessions left."
            : `You can start ${b.sessions_available} ${
                b.sessions_available === 1 ? "session" : "sessions"
              } now.`}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {b.trial_available && <li>1 free trial session</li>}
          {b.referral_credits_available > 0 && (
            <li>{b.referral_credits_available} from inviting friends</li>
          )}
        </ul>
        {!b.payments_enabled && (
          <p className="pt-1 text-xs text-muted">
            More sessions will be pay per session. Payments are coming soon.
          </p>
        )}
        {b.sessions_available > 0 && (
          <Link to="/session/new" className="btn-secondary mt-2 w-fit">
            Start a session
          </Link>
        )}
      </section>

      <p className="text-xs text-muted">
        A friend counts once they have signed up with your link and confirmed
        their email. Inviting yourself, a second address of your own, or an
        account made on your own device does not count. See the{" "}
        <Link to="/terms" className="underline">
          terms
        </Link>
        .
      </p>
    </main>
  );
}
