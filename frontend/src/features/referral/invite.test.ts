import { captureInvite, savedInvite } from "./invite";

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
