import { captureInvite, savedInvite, savedUtm } from "./invite";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("invite codes", () => {
  it("remembers a code found in the address, in lower case", () => {
    captureInvite("?ref=AbC23xyz");
    expect(savedInvite()).toBe("abc23xyz");
  });

  it("keeps it for later pages, since the address changes as people move around", () => {
    captureInvite("?utm=x&ref=abc23xyz");
    captureInvite(""); // a later page without a code does not erase it
    expect(savedInvite()).toBe("abc23xyz");
  });

  it.each(["", "ab", "<script>", "a b c d e", "x".repeat(40), "bad!code"])(
    "ignores %j",
    (bad) => {
      captureInvite(`?ref=${encodeURIComponent(bad)}`);
      expect(savedInvite()).toBeUndefined();
    },
  );

  it("never throws when the browser will not store it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => captureInvite("?ref=abc23xyz")).not.toThrow();
    expect(savedInvite()).toBeUndefined();
  });

  it("a newer valid code replaces the old one", () => {
    captureInvite("?ref=first1111");
    captureInvite("?ref=second222");
    expect(savedInvite()).toBe("second222");
  });
});

describe("campaign tags", () => {
  beforeEach(() => localStorage.clear());

  it("remembers utm tags from the address", () => {
    captureInvite(
      "?utm_source=linkedin&utm_medium=social&utm_campaign=launch-week",
    );
    expect(savedUtm()).toEqual({
      source: "linkedin",
      medium: "social",
      campaign: "launch-week",
    });
  });

  it("keeps the first campaign, so a later visit does not take the credit", () => {
    captureInvite("?utm_source=linkedin");
    captureInvite("?utm_source=twitter&utm_campaign=other");
    expect(savedUtm()).toEqual({ source: "linkedin" });
  });

  it("cleans markup out of a tag and bounds its length", () => {
    captureInvite(
      `?utm_source=${encodeURIComponent("<script>x</script>")}&utm_campaign=${"a".repeat(200)}`,
    );
    expect(savedUtm()?.source).toBe("scriptxscript");
    expect(savedUtm()?.campaign).toHaveLength(60);
  });

  it("remembers nothing when there are no tags, and never throws when storage is blocked", () => {
    captureInvite("?foo=bar");
    expect(savedUtm()).toBeUndefined();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => captureInvite("?utm_source=x")).not.toThrow();
    expect(savedUtm()).toBeUndefined();
  });

  it("keeps an invite code and a campaign together", () => {
    captureInvite("?ref=abc23xyz&utm_source=friend");
    expect(savedInvite()).toBe("abc23xyz");
    expect(savedUtm()).toEqual({ source: "friend" });
  });
});
