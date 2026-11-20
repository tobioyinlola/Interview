/** The model writes `TYPE: ...`, then `ANSWER: ...`, then a `SOURCES:` list. The panel shows only the
 *  answer, so this cuts the other parts away, including while the text is still arriving (a half-typed
 *  `SOUR` at the end is never shown). Text saved by the earlier format (`SAMPLE ANSWER:`) works too. */
const MARKER = /^[ \t]*(?:SAMPLE[ \t]+)?ANSWER[ \t]*:[ \t]*/im;
const NEXT = /^[ \t]*(?:SOURCES|POINTS|CLOSE)[ \t]*:/im;
const PARTIAL_HEADING =
  /\n[ \t]*(?:S|SO|SOU|SOUR|SOURC|SOURCE|SOURCES|P|PO|POI|POIN|POINT|POINTS|C|CL|CLO|CLOS|CLOSE)[ \t]*$/i;
/** If no ANSWER: ever shows up, the model ignored the format; show what it wrote past this length. */
const GIVE_UP_AFTER = 60;

export function answerOf(text: string, streaming = false): string {
  const start = MARKER.exec(text);
  if (!start) {
    const rest = text.replace(/^\s*TYPE[ \t]*:[^\n]*\n?/i, "").trim();
    return streaming && rest.length < GIVE_UP_AFTER ? "" : rest;
  }
  let body = text.slice(start.index + start[0].length);
  const next = NEXT.exec(body);
  if (next) body = body.slice(0, next.index);
  else if (streaming) body = body.replace(PARTIAL_HEADING, "");
  return body.trim();
}
