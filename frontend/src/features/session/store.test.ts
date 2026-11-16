import { type Line, assembleTurn } from "./store";

const p = (id: string, text: string): Line => ({
  key: id,
  id,
  speaker: "partner",
  text,
});
const you = (text: string): Line => ({ key: text, speaker: "you", text });

describe("assembleTurn", () => {
  it("joins up to the last 3 partner utterances", () => {
    const t = assembleTurn([
      p("1", "One."),
      p("2", "Two."),
      p("3", "Three."),
      p("4", "Four?"),
    ]);
    expect(t).toEqual({ text: "Two. Three. Four?", ids: ["2", "3", "4"] });
  });
  it("stops at the moment the user spoke", () => {
    const t = assembleTurn([
      p("1", "Old question?"),
      you("My answer."),
      p("2", "So,"),
      p("3", "why us?"),
    ]);
    expect(t).toEqual({ text: "So, why us?", ids: ["2", "3"] });
  });
  it("is empty if the user spoke last", () => {
    expect(assembleTurn([p("1", "Q?"), you("A.")])).toEqual({
      text: "",
      ids: [],
    });
  });
  it("skips gap markers and typed lines", () => {
    const t = assembleTurn([
      p("1", "Tell me"),
      { key: "g", speaker: "gap", text: "[lost]" },
      { key: "t", speaker: "typed", text: "typed" },
      p("2", "about yourself?"),
    ]);
    expect(t.text).toBe("Tell me about yourself?");
  });
  it("handles an empty transcript", () => {
    expect(assembleTurn([])).toEqual({ text: "", ids: [] });
  });
});
