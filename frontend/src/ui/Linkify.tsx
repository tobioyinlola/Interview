import type { ReactNode } from "react";

// http(s) addresses and www. addresses; a trailing full stop, comma or bracket is not part of it
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,;:!?)\]}]/gi;

/** Text with every web address in it made into a link that opens in a new tab. Only http and https
 *  addresses are linked (never javascript: or anything else), and the text is never treated as HTML. */
export function Linkify({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const shown = m[0];
    const href = /^www\./i.test(shown) ? `https://${shown}` : shown;
    parts.push(
      <a
        key={at}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-accent-dark underline"
      >
        {shown}
      </a>,
    );
    last = at + shown.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
