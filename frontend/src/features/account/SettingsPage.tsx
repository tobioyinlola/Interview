import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useDeleteAccount } from "../../api/hooks";

export function PrivacyNotice() {
  return (
    <section aria-labelledby="privacy" className="space-y-2">
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

export function SettingsPage() {
  return (
    <main className="page-narrow">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <PrivacyNotice />
      <section aria-labelledby="danger" className="space-y-2">
        <h2 id="danger" className="text-lg font-semibold">
          Delete my data
        </h2>
        <DeleteAccountButton />
      </section>
    </main>
  );
}
