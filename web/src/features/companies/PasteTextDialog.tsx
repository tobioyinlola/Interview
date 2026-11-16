import { type FormEvent, useEffect, useRef, useState } from "react";

export const PASTE_MAX = 50_000;

interface Props {
  initialTitle?: string;
  pending: boolean;
  error?: string | null;
  onSave: (input: { title: string; text: string }) => void;
  onClose: () => void;
}

/** For pages the app could not read: the user pastes the text and it becomes a source labelled
 *  "Pasted by you". */
export function PasteTextDialog({
  initialTitle = "",
  pending,
  error,
  onSave,
  onClose,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => textRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ title: title.trim() || "Pasted text", text: text.trim() });
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-h"
        onSubmit={submit}
        className="w-full max-w-xl space-y-3 rounded bg-white p-5 shadow"
      >
        <h2 id="paste-h" className="text-lg font-medium">
          Paste text from the page
        </h2>
        <p className="text-sm text-muted">
          Copy the page&apos;s text in your browser and paste it here. It will
          be used as a source, labelled &quot;Pasted by you&quot;.
        </p>
        <div>
          <label htmlFor="p-title" className="block text-sm font-medium">
            Name for this text
          </label>
          <input
            id="p-title"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="p-text" className="block text-sm font-medium">
            Text
          </label>
          <textarea
            id="p-text"
            ref={textRef}
            rows={10}
            maxLength={PASTE_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
          <p className="text-right text-xs text-muted">
            {text.length.toLocaleString()} / {PASTE_MAX.toLocaleString()}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border px-3 py-2"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="rounded bg-accent px-3 py-2 text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save text"}
          </button>
        </div>
      </form>
    </div>
  );
}
