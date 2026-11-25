import { useState } from "react";

import type { AdminMarketing } from "../../api/types";
import { useMarketing } from "./api";
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
} from "./ui";

type Row = AdminMarketing["by_method"][number];

function Channels({
  title,
  intro,
  rows,
  empty,
}: {
  title: string;
  intro: string;
  rows: Row[];
  empty: string;
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted">{intro}</p>
      </div>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <Table
          label={title}
          head={[
            "Channel",
            "Sign-ups",
            "Ran an interview",
            "Activation",
            "Ran a second",
          ]}
        >
          {rows.map((r) => (
            <tr key={r.channel}>
              <th scope="row" className="px-4 py-3 font-medium">
                {r.channel}
              </th>
              <td className="px-4 py-3">{num(r.signups)}</td>
              <td className="px-4 py-3">{num(r.activated)}</td>
              <td className="px-4 py-3">{pct(r.activation_pct)}</td>
              <td className="px-4 py-3">{num(r.second_session)}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}

/** Where sign-ups come from, how far each channel gets, how much the invite loop adds, and the
 *  signals that matter for pricing. */
export function MarketingPage() {
  const [days, setDays] = useState(30);
  const q = useMarketing(days);
  if (q.isPending) return <Loading what="marketing" />;
  if (q.isError) return <Failed what="marketing" />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHead
        title="Marketing"
        intro="Where people come from and whether they stick. Add campaign tags to your links (for example ?utm_source=linkedin&utm_campaign=launch) and they show up here."
        right={<DaysSelect days={days} onChange={setDays} />}
      />
      <dl
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="Acquisition numbers"
      >
        <Stat
          label="Sign-ups"
          value={num(d.signups)}
          hint={`last ${days} days`}
        />
        <Stat label="Came from an invite" value={pct(d.referred_pct)} />
        <Stat
          label="Invite loop (k)"
          value={d.k_factor.toFixed(2)}
          hint="invited sign-ups per sign-up"
        />
        <Stat
          label="Time to first interview"
          value={
            d.median_hours_to_first_session === null
              ? "–"
              : `${d.median_hours_to_first_session} h`
          }
          hint="the middle person"
        />
      </dl>

      <section aria-labelledby="price-h" className="space-y-2">
        <h2 id="price-h" className="text-base font-semibold tracking-tight">
          Signals for pricing
        </h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Used their free interview"
            value={num(d.trial_used_users)}
          />
          <Stat
            label="Hit the wall (no interviews left)"
            value={num(d.hit_paywall_users)}
            hint="people who tried to start"
          />
          <Stat
            label="Ran a second interview"
            value={num(d.second_session_users)}
          />
          <Stat
            label="Redeemed an invite reward"
            value={num(d.redeemed_rewards)}
          />
        </dl>
        <p className="text-sm text-muted">
          People who hit the wall are your clearest sign of demand for paid
          interviews.
        </p>
      </section>

      <Channels
        title="By source"
        intro="The campaign tag on the link, or invite, or direct when there was none."
        rows={d.by_source}
        empty="No sign-ups in this period."
      />
      <Channels
        title="By campaign"
        intro="Sign-ups carrying a utm_campaign tag."
        rows={d.by_campaign}
        empty="No campaign tags yet. Add ?utm_campaign=name to a link you share."
      />
      <Channels
        title="By sign-up method"
        intro="Password, emailed link, or Google."
        rows={d.by_method}
        empty="No sign-ups in this period."
      />
    </div>
  );
}
