/** A cheap first test of whether the interviewer is asking something that needs an answer. It only
 *  decides whether it is worth asking the server; the server's model has the last word. Chatter
 *  ("Right.", "Mm-hm, that's great", "I'll just add that this team is small") never passes. */
const OPENERS =
  /^(?:(?:so|okay|ok|right|well|and|but|now|alright|great|then)[,.]?\s+)*(?:tell|walk|talk|describe|explain|share|give|take|run|show|what|why|how|when|where|who|which|whose|can|could|would|will|do|does|did|have|has|had|are|is|was|were|should|if|imagine|suppose|let's|let us|i'd like you|i would like you|i want you|i'm curious|i wonder)\b/i;

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  if (t.includes("?")) return true;
  return t
    .split(/(?<=[.!])\s+/)
    .some((sentence) => OPENERS.test(sentence.trim()));
}
