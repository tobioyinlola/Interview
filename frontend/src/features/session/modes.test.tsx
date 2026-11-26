import { render, screen } from "@testing-library/react";

import type { OutlineRequest } from "../../audio/suggestStream";
import { LiveSessionController } from "./controller";
import { AssistantStatus } from "./modes";
import { useLiveStore } from "./store";

describe("interview modes", () => {
  it("says plainly which mode is on and whether answers are on", () => {
    const { rerender } = render(<AssistantStatus mode="mock" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Assistant on: mock interview",
    );
    rerender(<AssistantStatus mode="assisted" authorizedBy="Jo at Acme" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Assistant on: authorised live assistance (authorised by Jo at Acme)",
    );
    rerender(<AssistantStatus mode="standard" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Standard interview: real-time answers are off",
    );
  });

  it("never asks for an answer in a Standard Interview, even for a typed question", async () => {
    useLiveStore.getState().reset();
    const asked: OutlineRequest[] = [];
    const ctl = new LiveSessionController({
      sessionId: "s1",
      sampleRate: 24000,
      fetchToken: async () => "t",
      endSession: async () => undefined,
      answersOff: () => true,
      stream: async (req) => {
        asked.push(req);
      },
    });
    ctl.submitManual("Tell me about yourself?");
    await Promise.resolve();
    expect(asked).toEqual([]);
    expect(useLiveStore.getState().outline).toBeNull();
  });
});
