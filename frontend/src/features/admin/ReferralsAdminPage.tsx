import { useState } from "react";
import { Link } from "react-router-dom";

import { useAdminReferrals, useApproveReferral } from "./api";
import {
  DaysSelect,
  Empty,
  Failed,
  Loading,
  PageHead,
  Stat,
  Table,
  num,
  pct,
  when,
} from "./ui";

/** How invites are working: totals, who invites the most, and sign-ups held for looking like the
 *  inviter's own device, which an admin can count if they are really a different person. */
export function ReferralsAdminPage() {
  const [days, setDays] = useState(30);
  const q = useAdminReferrals(days);
  const approve = useApproveReferral();
  if (q.isPending) return <Loading what="invites" />;
  if (q.isError) return <Failed what="invites" />;
  const d = q.data;

  return (
    <div className="space-y-6">
      <PageHead
        title="Referrals"
        intro={`People who sign up with an invite link. ${d.per_reward} counted sign-ups earn one free interview, which the inviter redeems.`}
        right={<DaysSelect days={days} onChange={setDays} />}
      />
      <dl
        className="grid grid-cols-2 gap-3 md:grid-cols-5"
        aria-label="Invite numbers"
      >
        <Stat feature label="Invited sign-ups" value={num(d.total)} />
        <Stat label="Counted" value={num(d.counted)} />
        <Stat
          label="Held"
          value={num(d.held)}
          hint="looked like the same device"
        />
        <Stat
          label="Free interviews earned"
          value={num(d.rewards_earned)}
          hint={`${d.rewards_redeemed} redeemed`}
        />
        <Stat
          label={`Share of new sign-ups (${days} d)`}
          value={pct(d.referred_signups_pct)}
        />
      </dl>

      <section aria-labelledby="top-h" className="space-y-2">
        <h2 id="top-h" className="text-base font-semibold tracking-tight">
          Top inviters
        </h2>
        {d.top_referrers.length === 0 ? (
          <Empty>Nobody has invited anyone yet.</Empty>
        ) : (
          <Table
            label="Top inviters"
            head={["Person", "Counted", "Held", "Earned", "Redeemed"]}
          >
            {d.top_referrers.map((r) => (
              <tr key={r.user_id}>
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/users/${r.user_id}`}
                    className="text-accent-dark underline"
                  >
                    {r.email}
                  </Link>
                </td>
                <td className="px-4 py-3">{num(r.counted)}</td>
                <td className="px-4 py-3">{num(r.held)}</td>
                <td className="px-4 py-3">{num(r.rewards_earned)}</td>
                <td className="px-4 py-3">{num(r.rewards_redeemed)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section aria-labelledby="held-h" className="space-y-2">
        <h2 id="held-h" className="text-base font-semibold tracking-tight">
          Held sign-ups
        </h2>
        <p className="text-sm text-muted">
          These came from the same device as their inviter, so they did not
          count. If it is a real, different person (a housemate, say), count it.
        </p>
        {approve.isError && (
          <p role="alert" className="notice-error">
            {approve.error.message}
          </p>
        )}
        {d.held_items.length === 0 ? (
          <Empty>Nothing is being held.</Empty>
        ) : (
          <Table
            label="Held sign-ups"
            head={["When", "Inviter", "Signed up", "Why", ""]}
          >
            {d.held_items.map((h) => (
              <tr key={h.id}>
                <td className="px-4 py-3 text-muted">{when(h.at)}</td>
                <td className="px-4 py-3">{h.referrer_email}</td>
                <td className="px-4 py-3">{h.referred_email}</td>
                <td className="px-4 py-3 text-muted">
                  {h.reason === "same_device"
                    ? "Same device"
                    : (h.reason ?? "")}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="btn-secondary btn-sm"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate(h.id)}
                    aria-label={`Count the sign-up of ${h.referred_email}`}
                  >
                    Count it
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
