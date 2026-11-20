import { answerOf } from "./answerText";

const FULL =
  "TYPE: behavioral\nANSWER: I led the launch. Onboarding fell by 30%.\nSOURCES:\n- Led launch [note: Launch]";

describe("answerOf", () => {
  it("returns only the spoken answer", () => {
    expect(answerOf(FULL)).toBe("I led the launch. Onboarding fell by 30%.");
  });

  it("shows nothing until the answer starts, and never a half-typed heading", () => {
    expect(answerOf("TYPE: behavioral", true)).toBe("");
    expect(answerOf("TYPE: behavioral\nAN", true)).toBe("");
    expect(answerOf("TYPE: behavioral\nANSWER: I led", true)).toBe("I led");
    expect(answerOf("TYPE: x\nANSWER: I led it.\nSOU", true)).toBe("I led it.");
    expect(answerOf("TYPE: x\nANSWER: I led it.\nSOURCES:\n- a", true)).toBe(
      "I led it.",
    );
  });

  it("does not cut a real sentence that merely starts with those letters", () => {
    expect(answerOf("TYPE: x\nANSWER: I shipped it so", true)).toBe(
      "I shipped it so",
    );
  });

  it("shows text saved in the earlier format's sample answer", () => {
    const old =
      "TYPE: behavioral\nOPENER: Sure.\nPOINTS:\n- a [general]\nCLOSE: Thanks.\nSAMPLE ANSWER: For example, I led it.";
    expect(answerOf(old)).toBe("For example, I led it.");
  });

  it("falls back to the whole text if the model ignored the format", () => {
    const loose =
      "Here is a thoughtful answer that has no label at all, only prose.";
    expect(answerOf(loose)).toBe(loose);
    expect(answerOf("Short", true)).toBe(""); // still waiting to see if a label follows
    expect(answerOf(loose, true)).toBe(loose);
  });

  it("keeps a multi-line answer intact", () => {
    expect(answerOf("TYPE: x\nANSWER: One.\nTwo.\nSOURCES:\n- z")).toBe(
      "One.\nTwo.",
    );
  });
});
