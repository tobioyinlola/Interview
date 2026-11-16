import { useState } from "react";

import type {
  Brief,
  BriefEdit,
  BriefFact,
  BriefSection,
  Source,
} from "../../api/types";

const LABELS: Record<string, string> = {
  from_you: "From you",
  pasted_by_you: "Pasted by you",
  suggestion: "Suggestion",
};

/** Only real web links become clickable. The server already enforces this; checking again keeps
 *  a stored `javascript:` URL from ever becoming a link. */
export const isWebUrl = (url: string | null | undefined): url is string =>
  !!url && /^https?:\/\//i.test(url);

function sourceName(s: Source): string {
  if (s.kind === "known") return "From you";
  if (s.title) return s.title;
  try {
    return s.url ? new URL(s.url).hostname : "Source";
  } catch {
    return "Source";
  }
}

type SourceIndex = Map<string, { n: number; s: Source }>;

/** What the page needs to let the user change the brief. Omit it for a read-only brief. */
export interface BriefEditing {
  onSave: (edits: BriefEdit[]) => void;
  pending: boolean;
  error?: string | null;
}

function SourceLinks({
  fact,
  sources,
}: {
  fact: BriefFact;
  sources: SourceIndex;
}) {
  return (
    <>
      {fact.source_ids.map((id) => {
        const found = sources.get(id);
        if (!found) return null;
        const { n, s } = found;
        const name = sourceName(s);
        return (
          <a
            key={id}
            href={isWebUrl(s.url) ? s.url : `#source-${s.id}`}
            {...(isWebUrl(s.url)
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            title={name}
            aria-label={`Source ${n}: ${name}`}
            className="ml-1 text-xs text-accent-dark underline"
          >
            [{n}]
          </a>
        );
      })}
    </>
  );
}

function PinToggle({
  pinned,
  onToggle,
  disabled,
}: {
  pinned: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pinned}
      disabled={disabled}
      onClick={onToggle}
      className={`tap rounded-lg border border-line px-1.5 text-xs hover:border-accent ${pinned ? "bg-yellow-100" : ""}`}
    >
      {pinned ? "Unpin" : "Pin"}
    </button>
  );
}

function Fact({
  fact,
  section,
  sources,
  editing,
}: {
  fact: BriefFact;
  section: BriefSection;
  sources: SourceIndex;
  editing?: BriefEditing;
}) {
  const [editingText, setEditingText] = useState(false);
  const [draft, setDraft] = useState(fact.text);
  const change = (over: Partial<BriefEdit>) =>
    editing?.onSave([
      {
        id: fact.id,
        section_key: section.key,
        text: fact.text,
        pinned: fact.pinned,
        ...over,
      },
    ]);

  return (
    <li className="py-1">
      {editingText ? (
        <span className="flex flex-col gap-1">
          <label className="sr-only" htmlFor={`edit-${fact.id}`}>
            Edit fact
          </label>
          <textarea
            id={`edit-${fact.id}`}
            value={draft}
            maxLength={500}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            className="input w-full"
          />
          <span className="flex gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!draft.trim() || editing?.pending}
              onClick={() => {
                change({ text: draft.trim() });
                setEditingText(false);
              }}
            >
              Save fact
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                setDraft(fact.text);
                setEditingText(false);
              }}
            >
              Cancel
            </button>
          </span>
        </span>
      ) : (
        <>
          <span>{fact.text}</span>
          {fact.date && (
            <span className="ml-2 rounded bg-canvas px-1 text-xs">
              {fact.date}
            </span>
          )}
          {fact.label && (
            <span
              className={`ml-2 rounded px-1 text-xs ${
                fact.label === "suggestion" ? "bg-amber-100" : "bg-green-100"
              }`}
            >
              {LABELS[fact.label]}
            </span>
          )}
          {fact.pinned && (
            <span className="ml-2 rounded bg-yellow-100 px-1 text-xs">
              Pinned
            </span>
          )}
          {fact.edited_by_user && fact.label !== "from_you" && (
            <span className="ml-2 rounded bg-accent-soft px-1 text-xs">
              Edited
            </span>
          )}
          <SourceLinks fact={fact} sources={sources} />
          {editing && (
            <span className="ml-2 inline-flex gap-1 align-middle">
              <PinToggle
                pinned={fact.pinned}
                disabled={editing.pending}
                onToggle={() => change({ pinned: !fact.pinned })}
              />
              <button
                type="button"
                className="tap rounded-lg border border-line px-1.5 text-xs hover:border-accent"
                aria-label={`Edit fact: ${fact.text.slice(0, 40)}`}
                onClick={() => setEditingText(true)}
              >
                Edit
              </button>
              <button
                type="button"
                className="tap rounded-lg border border-line px-1.5 text-xs text-red-700 hover:border-red-300 disabled:opacity-50"
                aria-label={`Delete fact: ${fact.text.slice(0, 40)}`}
                disabled={editing.pending}
                onClick={() => change({ delete: true })}
              >
                Delete
              </button>
            </span>
          )}
        </>
      )}
    </li>
  );
}

function AddFact({
  section,
  editing,
}: {
  section: BriefSection;
  editing: BriefEditing;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        className="btn-secondary btn-sm mt-1"
        onClick={() => setOpen(true)}
      >
        Add my own fact to {section.title}
      </button>
    );
  }
  return (
    <form
      className="mt-1 flex gap-2"
      aria-label={`Add a fact to ${section.title}`}
      onSubmit={(e) => {
        e.preventDefault();
        editing.onSave([
          { section_key: section.key, text: text.trim(), pinned: false },
        ]);
        setText("");
        setOpen(false);
      }}
    >
      <label className="sr-only" htmlFor={`add-${section.key}`}>
        New fact for {section.title}
      </label>
      <input
        id={`add-${section.key}`}
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        placeholder="Something you know. It is labelled From you."
        className="input w-full"
      />
      <button
        type="submit"
        disabled={!text.trim() || editing.pending}
        className="btn-primary btn-sm"
      >
        Add
      </button>
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
    </form>
  );
}

function Section({
  section,
  sources,
  editing,
}: {
  section: BriefSection;
  sources: SourceIndex;
  editing?: BriefEditing;
}) {
  const isSuggestions =
    section.facts.length > 0 &&
    section.facts.every((f) => f.label === "suggestion");
  return (
    <section
      aria-labelledby={`sec-${section.key}`}
      className="border-t border-line pt-3"
    >
      <h3 id={`sec-${section.key}`} className="font-medium">
        {section.title}
      </h3>
      {isSuggestions && (
        <p className="text-xs text-muted">
          Suggestions for you to consider, not facts.
        </p>
      )}
      {section.not_found ? (
        <p className="text-muted">Not found</p>
      ) : (
        <ul className="list-disc pl-5">
          {section.facts.map((f) => (
            <Fact
              key={f.id}
              fact={f}
              section={section}
              sources={sources}
              editing={editing}
            />
          ))}
        </ul>
      )}
      {editing && <AddFact section={section} editing={editing} />}
    </section>
  );
}

export function BriefView({
  brief,
  sources,
  editing,
}: {
  brief: Brief;
  sources: Source[];
  editing?: BriefEditing;
}) {
  // Footnote numbers follow the order sources are listed on the page.
  const index: SourceIndex = new Map(
    sources.map((s, i) => [s.id, { n: i + 1, s }]),
  );
  return (
    <article aria-label="Company brief" className="space-y-3">
      {editing?.error && (
        <p role="alert" className="notice-error">
          {editing.error}
        </p>
      )}
      {brief.assumed_company && (
        <p className="notice-warn">
          <strong>Assumed company:</strong> {brief.assumed_company}. If this is
          the wrong one, fix the website above and research again.
        </p>
      )}
      {brief.no_website && (
        <p className="text-sm text-muted">
          No website was given, so this brief uses web search only.
        </p>
      )}
      {!brief.web_search_done && (
        <p className="text-sm text-muted">
          Web search wasn&apos;t done this time, so this brief uses the pages
          you gave only.
        </p>
      )}
      {brief.sections.map((s) => (
        <Section key={s.key} section={s} sources={index} editing={editing} />
      ))}
    </article>
  );
}
