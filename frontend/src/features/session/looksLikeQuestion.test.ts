import { looksLikeQuestion } from "./looksLikeQuestion";

describe("looksLikeQuestion", () => {
  it.each([
    "Why do you want to work here?",
    "Tell me about a time you led a team.",
    "So, walk me through your last launch.",
    "Okay, and how did you prioritise the roadmap",
    "Right. Can you give me an example",
    "Describe a conflict with a stakeholder.",
    "I'd like you to talk about trade-offs.",
    "Imagine you had to cut scope in half.",
  ])("treats %j as something to answer", (q) => {
    expect(looksLikeQuestion(q)).toBe(true);
  });

  it.each([
    "Mm-hm.",
    "Right, okay.",
    "That's great, thanks.",
    "I'll just add that this team is quite small.",
    "Yes, exactly, that makes sense.",
    "We are a fast moving company.",
    "",
    "Nice weather",
  ])("never treats %j as a question", (q) => {
    expect(looksLikeQuestion(q)).toBe(false);
  });
});
