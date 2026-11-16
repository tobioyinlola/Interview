import { SseParser } from "./sse";

describe("SseParser", () => {
  it("parses whole events", () => {
    const p = new SseParser();
    expect(
      p.push('event: delta\ndata: {"text":"Hi"}\n\nevent: skip\ndata: {}\n\n'),
    ).toEqual([
      { event: "delta", data: { text: "Hi" } },
      { event: "skip", data: {} },
    ]);
  });
  it("reassembles an event split at any byte boundary", () => {
    const wire =
      'event: delta\ndata: {"text":"héllo wörld"}\n\nevent: done\ndata: {"a":1}\n\n';
    for (let cut = 1; cut < wire.length; cut++) {
      const p = new SseParser();
      const out = [...p.push(wire.slice(0, cut)), ...p.push(wire.slice(cut))];
      expect(out.map((e) => e.event)).toEqual(["delta", "done"]);
      expect(out[0].data).toEqual({ text: "héllo wörld" });
    }
  });
  it("handles CRLF line endings", () => {
    expect(
      new SseParser().push('event: delta\r\ndata: {"text":"a"}\r\n\r\n'),
    ).toHaveLength(1);
  });
  it("skips malformed data without failing the stream", () => {
    const p = new SseParser();
    expect(p.push("event: delta\ndata: {broken\n\n")).toEqual([]);
    expect(p.push('event: delta\ndata: {"text":"ok"}\n\n')).toHaveLength(1);
  });
  it("ignores comment/keep-alive blocks", () => {
    expect(new SseParser().push(": ping\n\n")).toEqual([]);
  });
});
