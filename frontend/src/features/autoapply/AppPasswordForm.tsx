import { type FormEvent, useState } from "react";
import { PrivateScreen } from "../../app/usePrivateScreen";

import { useMe } from "../../api/hooks";
import { useMailbox, useMailboxActions } from "./api";

/** Connect an email address with an app password instead of the Google button. Gmail, Outlook and
 *  Yahoo. The password is sent once to be checked and kept encrypted; it is never shown again. */
function AppPasswordFormInner({ onDone }: { onDone?: () => void }) {
  const { data: me } = useMe();
  const box = useMailbox();
  const { connectWithPassword } = useMailboxActions();
  const options = box.data?.smtp_providers ?? [];
  const [provider, setProvider] = useState("");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  if (options.length === 0) return null;
  const chosen = options.find((o) => o.id === (provider || options[0].id));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    connectWithPassword.mutate(
      {
        provider: chosen?.id ?? options[0].id,
        address: (address || me?.email || "").trim(),
        password,
      },
      {
        onSuccess: () => {
          setPassword("");
          onDone?.();
        },
      },
    );
  };
  return (
    <form
      onSubmit={submit}
      className="mt-3 space-y-3 rounded-2xl bg-surface p-4"
    >
      <p className="text-sm font-medium">Connect with an app password</p>
      <label className="block text-sm">
        <span className="font-medium">Email provider</span>
        <select
          className="input mt-1 w-full"
          value={chosen?.id}
          onChange={(e) => setProvider(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Your email address</span>
        <input
          type="email"
          required
          className="input mt-1 w-full"
          autoComplete="email"
          autoCapitalize="none"
          value={address || me?.email || ""}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">App password</span>
        <input
          type="password"
          required
          minLength={4}
          className="input mt-1 w-full"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <p className="text-xs text-muted">
        Not your usual password. Make one: {chosen?.help} We keep it encrypted,
        and you can delete it at your provider any time.
      </p>
      <button
        type="submit"
        className="btn-primary"
        disabled={connectWithPassword.isPending || password.length < 4}
      >
        {connectWithPassword.isPending ? "Checking…" : "Connect"}
      </button>
      {connectWithPassword.isError && (
        <p role="alert" className="notice-error">
          {connectWithPassword.error.message}
        </p>
      )}
    </form>
  );
}

/** A private screen: see app/privacy.ts. */
export function AppPasswordForm(props: { onDone?: () => void }) {
  return (
    <PrivateScreen>
      <AppPasswordFormInner {...props} />
    </PrivateScreen>
  );
}
