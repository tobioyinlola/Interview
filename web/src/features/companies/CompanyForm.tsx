import { type FormEvent, useEffect, useState } from "react";

import type { CompanyInput } from "../../api/types";

export const MAX_EXTRA_LINKS = 3;
export const KNOWN_MAX = 2000;

interface Props {
  initial?: Partial<CompanyInput>;
  /** Prefilled from the target role in the notes when adding a company. */
  defaultRole?: string;
  submitLabel: string;
  pending: boolean;
  error?: string | null;
  onSubmit: (input: CompanyInput) => void;
  onCancel?: () => void;
}

/** Company name is the only required field. Links are checked by the server (public web only);
 *  its message is shown here and everything typed is kept. */
export function CompanyForm({
  initial,
  defaultRole = "",
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [website, setWebsite] = useState(initial?.website_url ?? "");
  const [posting, setPosting] = useState(initial?.job_posting_url ?? "");
  const [extra, setExtra] = useState<string[]>(initial?.extra_links ?? []);
  const [role, setRole] = useState(initial?.role ?? defaultRole);
  const [roleTouched, setRoleTouched] = useState(false);

  // The notes may finish loading after the form opens. Until the user types their own role (or
  // the form is editing a saved company), follow the target role from their notes.
  useEffect(() => {
    if (!roleTouched && initial?.role === undefined) setRole(defaultRole);
  }, [defaultRole, roleTouched, initial?.role]);
  const [known, setKnown] = useState(initial?.known_text ?? "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      website_url: website.trim() || null,
      job_posting_url: posting.trim() || null,
      extra_links: extra.map((x) => x.trim()).filter(Boolean),
      role: role.trim(),
      known_text: known.trim(),
    });
  };

  const field = "mt-1 w-full rounded border px-3 py-2";
  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Company details">
      <div>
        <label htmlFor="c-name" className="block text-sm font-medium">
          Company name
        </label>
        <input
          id="c-name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="c-site" className="block text-sm font-medium">
          Company website{" "}
          <span className="font-normal text-gray-600">(recommended)</span>
        </label>
        <input
          id="c-site"
          type="url"
          placeholder="https://"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="c-job" className="block text-sm font-medium">
          Job posting link{" "}
          <span className="font-normal text-gray-600">(recommended)</span>
        </label>
        <input
          id="c-job"
          type="url"
          placeholder="https://"
          value={posting}
          onChange={(e) => setPosting(e.target.value)}
          className={field}
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">
          Other links{" "}
          <span className="font-normal text-gray-600">
            (up to {MAX_EXTRA_LINKS})
          </span>
        </legend>
        {extra.map((value, i) => (
          <div key={i} className="mt-1 flex gap-2">
            <input
              aria-label={`Extra link ${i + 1}`}
              type="url"
              placeholder="https://"
              value={value}
              onChange={(e) =>
                setExtra(extra.map((x, j) => (j === i ? e.target.value : x)))
              }
              className="w-full rounded border px-3 py-2"
            />
            <button
              type="button"
              className="rounded border px-2"
              aria-label={`Remove extra link ${i + 1}`}
              onClick={() => setExtra(extra.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="mt-2 rounded border px-2 py-1 text-sm disabled:opacity-50"
          disabled={extra.length >= MAX_EXTRA_LINKS}
          onClick={() => setExtra([...extra, ""])}
        >
          Add a link
        </button>
        <p className="mt-1 text-xs text-gray-600">
          Public pages only, such as an About page or a news article. Pages
          behind a sign-in can&apos;t be read: paste their text afterwards
          instead.
        </p>
      </fieldset>

      <div>
        <label htmlFor="c-role" className="block text-sm font-medium">
          Role
        </label>
        <input
          id="c-role"
          maxLength={200}
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setRoleTouched(true);
          }}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="c-known" className="block text-sm font-medium">
          What I already know
        </label>
        <textarea
          id="c-known"
          rows={4}
          maxLength={KNOWN_MAX}
          value={known}
          onChange={(e) => setKnown(e.target.value)}
          className={field}
        />
        <p className="mt-1 text-right text-xs text-gray-600">
          {known.length.toLocaleString()} / {KNOWN_MAX.toLocaleString()}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded border border-red-700 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="rounded border px-4 py-2"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
