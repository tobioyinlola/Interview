import { useEffect, useMemo, useState } from "react";

import { saveNotes, useNotes } from "../../api/hooks";
import { SaveIndicator } from "./SaveIndicator";
import { useAutosave } from "./useAutosave";

export const NOTES_MAX = 16_000;

export function NotesPage() {
  const { data, isPending, isError } = useNotes();
  const [role, setRole] = useState("");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (data && !loaded) {
      setRole(data.role);
      setContent(data.content);
      setLoaded(true);
    }
  }, [data, loaded]);

  const value = useMemo(() => ({ role, content }), [role, content]);
  const { status, retry } = useAutosave(value, saveNotes, { enabled: loaded });

  if (isPending) return <p className="p-8">Loading…</p>;
  if (isError)
    return (
      <p className="p-8">Couldn&apos;t load your notes. Reload to try again.</p>
    );

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Your notes</h1>
      <p className="text-sm text-gray-600">
        Outlines use only what you write here (and any company brief). Add
        stories, results and facts you want to be able to cite.
      </p>
      <div>
        <label htmlFor="role" className="block text-sm font-medium">
          Target role
        </label>
        <input
          id="role"
          maxLength={200}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
          placeholder="e.g. Senior Product Manager"
        />
      </div>
      <div>
        <label htmlFor="notes" className="block text-sm font-medium">
          Experience notes
        </label>
        <textarea
          id="notes"
          rows={18}
          maxLength={NOTES_MAX}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
        />
        <div className="mt-1 flex justify-between">
          <SaveIndicator status={status} onRetry={() => void retry()} />
          <span className="text-sm text-gray-600">
            {content.length.toLocaleString()} / {NOTES_MAX.toLocaleString()}
          </span>
        </div>
      </div>
    </main>
  );
}
