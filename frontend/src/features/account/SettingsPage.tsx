import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useDeleteAccount, useMe, useSaveProfile } from "../../api/hooks";

export function PrivacyNotice() {
  return (
    <section aria-labelledby="privacy" className="card space-y-2">
      <h2 id="privacy" className="text-lg font-semibold">
        Privacy and responsible use
      </h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>
          This app is for practice with a partner who knows the assistant is on.
        </li>
        <li>
          Recording and transcribing calls is regulated differently in different
          places. Get your partner&apos;s agreement and follow local law.
        </li>
        <li>
          Audio is relayed for transcription and discarded. Only text is saved.
        </li>
        <li>
          Audio and text are processed by OpenAI to transcribe, research and
          write outlines. Your content is not used to train models.
        </li>
        <li>
          You can delete a session, a company, or your whole account at any
          time.
        </li>
      </ul>
    </section>
  );
}

export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false);
  const del = useDeleteAccount();
  const navigate = useNavigate();

  if (!confirming) {
    return (
      <button
        className="btn-danger-outline"
        onClick={() => setConfirming(true)}
      >
        Delete my account and data
      </button>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-label="Confirm deletion"
      className="card space-y-2 border border-red-200"
    >
      <p>
        This permanently deletes your CV, companies, sessions and account. It
        disappears from the app immediately and from storage within 30 days.
      </p>
      <div className="flex gap-2">
        <button
          className="btn-danger"
          disabled={del.isPending}
          onClick={() =>
            del.mutate(undefined, { onSuccess: () => navigate("/login") })
          }
        >
          {del.isPending ? "Deleting…" : "Yes, delete everything"}
        </button>
        <button className="btn-secondary" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      {del.isError && (
        <p role="alert" className="text-sm text-red-700">
          {del.error.message}
        </p>
      )}
    </div>
  );
}

function NameForm() {
  const { data: me } = useMe();
  const save = useSaveProfile();
  const [name, setName] = useState(me?.full_name ?? "");
  const changed = name.trim() !== (me?.full_name ?? "");
  return (
    <section aria-labelledby="profile-h" className="card space-y-2">
      <h2 id="profile-h" className="text-lg font-semibold">
        Your name
      </h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed)
            save.mutate(name.trim(), {
              // show the name as saved, tidied, not as typed
              onSuccess: (me) => setName(me.full_name ?? ""),
            });
        }}
      >
        <div className="min-w-0 flex-1 basis-60">
          <label htmlFor="profile-name" className="block text-sm font-medium">
            Full name
          </label>
          <input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={120}
            className="input mt-1 w-full"
          />
        </div>
        <button
          type="submit"
          disabled={!changed || name.trim().length < 2 || save.isPending}
          className="btn-primary"
        >
          {save.isPending ? "Saving…" : "Save name"}
        </button>
      </form>
      {save.isSuccess && !changed && (
        <p role="status" className="text-sm text-muted">
          Saved.
        </p>
      )}
      {save.isError && (
        <p role="alert" className="notice-error">
          {save.error.message}
        </p>
      )}
    </section>
  );
}

export function SettingsPage() {
  return (
    <main className="page-narrow">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <NameForm />
      <PrivacyNotice />
      <section
        aria-labelledby="danger"
        className="card space-y-2 !border !border-red-200"
      >
        <h2 id="danger" className="text-lg font-semibold">
          Delete my data
        </h2>
        <DeleteAccountButton />
      </section>
    </main>
  );
}
