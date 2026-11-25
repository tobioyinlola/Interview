import { type FormEvent, type ReactNode, useState } from "react";

import { useMe } from "../../api/hooks";
import { useMailbox, useMailboxActions } from "../autoapply/api";
import { useReach } from "./api";

/** The top of every Startups screen: what this does for you, in one line, with the real number. */
export function StartupHero() {
  const reach = useReach();
  const label =
    reach.data && reach.data.companies >= 10 ? reach.data.label : null;
  return (
    <header className="rounded-3xl bg-gradient-to-br from-ink via-ink to-accent-dark p-6 text-surface shadow-lift sm:p-8">
      <p className="text-sm font-medium text-surface/70">Startup outreach</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
        Auto outreach to {label ? `${label} companies` : "companies"} that need
        you
      </h1>
      <p className="mt-3 max-w-xl text-surface/85">
        We write to startups hiring for your role, from your Gmail. You approve
        each one.
      </p>
    </header>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-surface"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

const link = "font-medium text-accent-dark underline";

/** Check that a connected mailbox still works, by logging in to it again. Nothing is sent. */
export function MailboxConfirmed({
  address,
  onContinue,
}: {
  address: string;
  onContinue?: () => void;
}) {
  const { check } = useMailboxActions();
  return (
    <section
      aria-label="Gmail connected"
      className="space-y-3 rounded-2xl bg-emerald-50 p-5 text-emerald-950 shadow-card"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-surface"
        >
          ✓
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            Gmail connected and confirmed
          </h2>
          <p className="break-all font-medium">{address}</p>
          <p className="mt-1 text-sm">
            We signed in with it and it worked. Nothing was sent. Pitches go out
            from this address and show in your Sent folder.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {onContinue && (
          <button type="button" className="btn-primary" onClick={onContinue}>
            Continue
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          disabled={check.isPending}
          onClick={() => check.mutate()}
        >
          {check.isPending ? "Checking…" : "Check again"}
        </button>
        {check.isSuccess && (
          <span role="status" className="text-sm font-medium">
            Confirmed just now
          </span>
        )}
      </div>
      {check.isError && (
        <p role="alert" className="notice-error">
          {check.error.message}
        </p>
      )}
    </section>
  );
}

/** The Gmail steps, and the two fields that finish them: the address and an app password. */
export function GmailConnect({ onConnected }: { onConnected: () => void }) {
  const { data: me } = useMe();
  const box = useMailbox();
  const { connect, connectWithPassword } = useMailboxActions();
  const viaPassword = (box.data?.smtp_providers ?? []).some(
    (p) => p.id === "gmail",
  );
  const guess = /@(gmail|googlemail)\.com$/i.test(me?.email ?? "")
    ? (me?.email ?? "")
    : "";
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const shown = address || guess;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    connectWithPassword.mutate(
      { provider: "gmail", address: shown.trim(), password },
      {
        onSuccess: () => {
          setPassword("");
          onConnected();
        },
      },
    );
  };
  const retry = box.data?.status === "reauth_needed";
  return (
    <section
      aria-label="Connect your Gmail"
      className="space-y-5 rounded-2xl bg-surface p-5 shadow-card sm:p-6"
    >
      <div>
        <h2 className="text-xl font-semibold">
          {retry
            ? "Reconnect your Gmail"
            : "Connect your Gmail to start sending"}
        </h2>
        <p className="mt-1 text-muted">
          {retry
            ? "Connect again with a Gmail app password to keep sending."
            : "Replies come straight to you. It takes two minutes."}
        </p>
      </div>

      {viaPassword ? (
        <>
          <ol className="space-y-5">
            <Step n={1} title="Turn on 2-Step Verification">
              <p className="text-sm text-muted">
                <a
                  className={link}
                  href="https://myaccount.google.com/security"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Google security
                </a>
              </p>
            </Step>
            <Step n={2} title="Make an app password">
              <p className="text-sm text-muted">
                Open{" "}
                <a
                  className={link}
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noreferrer"
                >
                  App passwords
                </a>
                , name it <b>InterviewMeet</b>, then copy the 16 letters.
              </p>
            </Step>
            <Step n={3} title="Paste your address and the app password">
              <form onSubmit={submit} className="space-y-3">
                <label className="block text-sm">
                  <span className="font-medium">Gmail address</span>
                  <input
                    type="email"
                    required
                    className="input mt-1 w-full"
                    autoComplete="email"
                    autoCapitalize="none"
                    placeholder="you@gmail.com"
                    value={shown}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">App password</span>
                  <input
                    type="password"
                    required
                    minLength={16}
                    className="input mt-1 w-full"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="16 letters, spaces do not matter"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <p className="text-xs text-muted">
                  Not your Gmail password. Kept encrypted; nothing is sent.
                </p>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={
                    connectWithPassword.isPending ||
                    password.replace(/\s/g, "").length < 16 ||
                    !shown.trim()
                  }
                >
                  {connectWithPassword.isPending
                    ? "Checking with Gmail…"
                    : "Connect and confirm"}
                </button>
                {connectWithPassword.isError && (
                  <p role="alert" className="notice-error">
                    {connectWithPassword.error.message}
                  </p>
                )}
              </form>
            </Step>
          </ol>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Press the button, choose your Google account, and allow
            InterviewMeet to send and read replies on your behalf.
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={connect.isPending}
            onClick={() => connect.mutate()}
          >
            Connect Gmail
          </button>
          {connect.isError && (
            <p role="alert" className="notice-error">
              Gmail could not be connected right now. Try again in a moment.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
