export interface SseEvent {
  event: string;
  data: unknown;
}

/** Incremental parser for a server-sent event stream. Chunks can split an event anywhere, so it
 *  buffers until a blank line ends each event. */
export class SseParser {
  private buffer = "";

  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:"))
          data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length === 0) continue;
      try {
        events.push({ event, data: JSON.parse(data.join("\n")) });
      } catch {
        /* a malformed event is skipped, never fatal */
      }
    }
    return events;
  }
}
