import { describe, expect, it } from "vitest";
import { rankGameweekScores } from "../../lib/gw-rank";

describe("gameweek ranks", () => {
  it("gives tied entrants the same rank and skips their places", () => {
    const ranks = rankGameweekScores([
      { userId: "a", points: 10, exacts: 2, goalError: 1 },
      { userId: "b", points: 10, exacts: 2, goalError: 1 },
      { userId: "c", points: 9, exacts: 2, goalError: 1 },
    ]);

    expect(ranks).toEqual(
      new Map([
        ["a", 1],
        ["b", 1],
        ["c", 3],
      ]),
    );
  });
});
