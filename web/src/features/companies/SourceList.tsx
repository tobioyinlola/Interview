import type { Source } from "../../api/types";
import { isWebUrl } from "./BriefView";

const KIND: Record<string, string> = {
  website: "Website",
  job_posting: "Job posting",
  extra_link: "Link",
  search_result: "Web search",
  pasted: "Pasted by you",
  known: "From you",
};

const STATUS_TEXT: Record<string, string> = {
  ok: "Read",
  blocked: "Could not read",
  login_required: "Needs sign-in",
  too_large: "Too large",
  timeout: "Timed out",
  disallowed: "Not allowed by the site",
};

interface Props {
  sources: Source[];
  onPaste: (title: string) => void;
  onRemove: (id: string) => void;
  removingId?: string | null;
}

export function SourceList({ sources, onPaste, onRemove, removingId }: Props) {
  if (sources.length === 0)
    return <p className="text-muted">No sources yet.</p>;
  return (
    <ol className="space-y-2">
      {sources.map((s, i) => {
        const failed = s.status !== "ok";
        const name = s.title || s.url || KIND[s.kind] || "Source";
        return (
          <li
            key={s.id}
            id={`source-${s.id}`}
            className="rounded border p-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">[{i + 1}]</span>
              <span className="rounded bg-canvas px-1 text-xs">
                {KIND[s.kind] ?? s.kind}
              </span>
              {isWebUrl(s.url) ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-dark underline"
                >
                  {name}
                </a>
              ) : (
                <span>{name}</span>
              )}
              <span
                className={`ml-auto rounded px-1 text-xs ${failed ? "bg-red-100 text-red-900" : "bg-green-100"}`}
              >
                {STATUS_TEXT[s.status] ?? s.status}
              </span>
            </div>
            {failed && s.reason && (
              <p className="mt-1 text-red-800">{s.reason}</p>
            )}
            <div className="mt-1 flex gap-2">
              {failed && (
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => onPaste(s.title || s.url || "")}
                >
                  Paste its text
                </button>
              )}
              <button
                className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                disabled={removingId === s.id}
                aria-label={`Remove source ${i + 1}`}
                onClick={() => onRemove(s.id)}
              >
                Remove
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
