import { render, screen } from "@testing-library/react";

import { ScoreCards } from "./ScoreCards";

it("shows nothing it was not given and never an unlabelled bar", () => {
  render(
    <ScoreCards
      scores={[
        {
          id: "1",
          utterance_id: "u",
          question_text: "Q?",
          answer_text: "A",
          structure: 0,
          specificity: 100,
          impact: 50,
          relevance: 25,
          pace: 75,
          overall: 50,
          fixes: ["a", "b", "c"],
        },
      ]}
    />,
  );
  for (const name of [
    "Structure",
    "Specificity",
    "Impact",
    "Relevance",
    "Pace",
  ]) {
    expect(
      screen.getByRole("meter", { name: `${name} score` }),
    ).toBeInTheDocument();
  }
  expect(
    screen.getByRole("meter", { name: "Structure score" }),
  ).toHaveAttribute("aria-valuenow", "0");
  expect(
    screen.getByRole("meter", { name: "Specificity score" }),
  ).toHaveAttribute("aria-valuenow", "100");
  expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(4); // the card plus its three fixes
  expect(screen.getByText("Answer 1")).toBeInTheDocument();
});
