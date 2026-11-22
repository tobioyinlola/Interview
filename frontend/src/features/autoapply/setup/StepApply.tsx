import { useMailbox, useMailboxActions } from "../api";
import { Fail } from "../ui";
import { OptionTile } from "./controls";
import type { Draft } from "./draft";

/** Step 5: which ways of applying are allowed, and the email connection. */
export function StepApply({
  d,
  set,
}: {
  d: Draft;
  set: (p: Partial<Draft>) => void;
}) {
  const box = useMailbox();
  const { connect, disconnect } = useMailboxActions();
  const connected = !!box.data?.connected;
  const flip = (k: keyof Draft["channels"]) =>
    set({ channels: { ...d.channels, [k]: !d.channels[k] } });
  const needsMail = (d.channels.email || d.channels.outreach) && !connected;
  return (
    <div className="space-y-4">
      <p className="rounded-2xl bg-accent-soft p-4 text-sm">
        Choose each way separately. You can change this at any time, and one tap
        pauses everything.
      </p>
      <OptionTile
        selected={d.channels.form}
        onClick={() => flip("form")}
        icon="📝"
        title="Employers' application forms"
        hint="We fill in the form with your confirmed details and CV."
      />
      <OptionTile
        selected={d.channels.email}
        onClick={() => flip("email")}
        icon="✉️"
        title="Email applications"
        hint="When a job says to apply by email, we send it from your own email address."
      />
      <OptionTile
        selected={d.channels.outreach}
        onClick={() => flip("outreach")}
        icon="🤝"
        title="A short note to the hiring contact"
        hint="One short, plain note per job, only when the listing names a contact."
      >
        {d.channels.outreach && (
          <label className="flex flex-wrap items-center gap-3 text-sm">
            <span>Most notes a day</span>
            <select
              aria-label="Most notes a day"
              className="input"
              value={d.outreachCap}
              onChange={(e) => set({ outreachCap: Number(e.target.value) })}
            >
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </OptionTile>

      <div id="email" className="rounded-2xl bg-canvas p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Your email</p>
            <p className="text-sm text-muted">
              {connected
                ? `Connected: ${box.data?.address}. Applications go from here and replies are read here. The messages stay in your inbox.`
                : box.data?.status === "reauth_needed"
                  ? "Your email needs to be connected again."
                  : "Needed only to email applications or notes, and to notice replies."}
            </p>
          </div>
          {connected ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect my email
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={connect.isPending || box.data?.can_connect === false}
              onClick={() => connect.mutate()}
            >
              Connect my email
            </button>
          )}
        </div>
        {box.data?.can_connect === false && (
          <p className="mt-2 text-xs text-muted">
            Connecting email is not set up on this server yet.
          </p>
        )}
        {needsMail && box.data?.can_connect !== false && (
          <p className="mt-2 text-sm text-amber-900">
            You chose an email option, so connect your email to continue.
          </p>
        )}
        <Fail error={connect.error ?? disconnect.error} />
      </div>
    </div>
  );
}
