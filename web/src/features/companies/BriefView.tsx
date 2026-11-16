import type { Brief, BriefFact, BriefSection, Source } from "../../api/types";

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

function Fact({
  fact,
  sources,
}: {
  fact: BriefFact;
  sources: Map<string, { n: number; s: Source }>;
}) {
  return (
    <li className="py-1">
      <span>{fact.text}</span>
      {fact.date && (
        <span className="ml-2 rounded bg-gray-100 px-1 text-xs">
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
      {fact.source_ids.map((id) => {
        const found = sources.get(id);
        if (!found) return null;
        const { n, s } = found;
        const name = sourceName(s);
        return isWebUrl(s.url) ? (
          <a
            key={id}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={name}
            aria-label={`Source ${n}: ${name}`}
            className="ml-1 text-xs text-blue-700 underline"
          >
            [{n}]
          </a>
        ) : (
          <a
            key={id}
            href={`#source-${s.id}`}
            title={name}
            aria-label={`Source ${n}: ${name}`}
            className="ml-1 text-xs text-blue-700 underline"
          >
            [{n}]
          </a>
        );
      })}
    </li>
  );
}

function Section({
  section,
  sources,
}: {
  section: BriefSection;
  sources: Map<string, { n: number; s: Source }>;
}) {
  const isSuggestions =
    section.facts.length > 0 &&
    section.facts.every((f) => f.label === "suggestion");
  return (
    <section aria-labelledby={`sec-${section.key}`} className="border-t pt-3">
      <h3 id={`sec-${section.key}`} className="font-medium">
        {section.title}
      </h3>
      {isSuggestions && (
        <p className="text-xs text-gray-600">
          Suggestions for you to consider, not facts.
        </p>
      )}
      {section.not_found ? (
        <p className="text-gray-600">Not found</p>
      ) : (
        <ul className="list-disc pl-5">
          {section.facts.map((f) => (
            <Fact key={f.id} fact={f} sources={sources} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function BriefView({
  brief,
  sources,
}: {
  brief: Brief;
  sources: Source[];
}) {
  // Footnote numbers follow the order sources are listed on the page.
  const index = new Map(sources.map((s, i) => [s.id, { n: i + 1, s }]));
  return (
    <article aria-label="Company brief" className="space-y-3">
      {brief.assumed_company && (
        <p className="rounded border border-amber-600 bg-amber-50 p-3 text-sm">
          <strong>Assumed company:</strong> {brief.assumed_company}. If this is
          the wrong one, fix the website above and research again.
        </p>
      )}
      {brief.no_website && (
        <p className="text-sm text-gray-700">
          No website was given, so this brief uses web search only.
        </p>
      )}
      {!brief.web_search_done && (
        <p className="text-sm text-gray-700">
          Web search wasn&apos;t done this time, so this brief uses the pages
          you gave only.
        </p>
      )}
      {brief.sections.map((s) => (
        <Section key={s.key} section={s} sources={index} />
      ))}
    </article>
  );
}
