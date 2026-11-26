/** When the interviewer's turn counts as finished. Kept apart from the controller so tests can
 *  shorten it without loading the whole live-session machinery. */

/** How long the interviewer must have been quiet before their turn is taken as finished. The answer
 *  is for the WHOLE turn, so these err on the side of waiting: a question often comes in pieces
 *  ("Tell me about yourself... and why this role?"), or several questions one after another, and an
 *  answer that starts on the first piece is wrong for the rest. */
export const DEFAULT_TIMING = {
  /** The turn so far ends with "?": it may be complete, but a second part often follows. */
  afterQuestionMs: 1500,
  /** A finished sentence that is not a question ("Walk me through your CV."). */
  afterStatementMs: 2000,
  /** It stopped mid-thought (ends in "and", "that", a comma...): the rest is coming. */
  unfinishedMs: 3500,
  /** The interviewer said several questions are coming ("I have a few questions"). */
  announcedMs: 6000,
  /** Never answer while sound from the interviewer was heard this recently, whatever the words say:
   *  the transcript runs behind the voice. */
  quietGuardMs: 700,
  /** The most the sound guard may add in total. */
  guardCapMs: 3500,
};
export type Timing = typeof DEFAULT_TIMING;
/** Mutable so a test can speed it up; the app never changes it. */
export const timing: Timing = { ...DEFAULT_TIMING };

/** A sentence that stopped without ending: the transcript gives a finished sentence its full stop or
 *  question mark, so a piece that has none was cut off mid-thought and the rest is coming. */
const ENDED = /[.?!]["'”’)\]]*\s*$/;

const ANNOUNCES_MORE =
  /\b(?:a few|a couple(?: of)?|two|three|four|five|several|some|multiple)\s+(?:more\s+)?(?:questions|things|parts|areas|topics)\b|\bfirst(?:ly)?\b\s*[,:]/i;

/** How long to wait, after the last words, before answering this turn. */
export function settleDelay(turn: string, last: string): number {
  const t = turn.trim();
  const marks = (t.match(/\?/g) ?? []).length;
  if (ANNOUNCES_MORE.test(t) && marks < 2) return timing.announcedMs;
  if (!ENDED.test(last)) return timing.unfinishedMs;
  if (/\?\s*$/.test(last)) return timing.afterQuestionMs;
  return timing.afterStatementMs;
}
