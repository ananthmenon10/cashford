import { describe, expect, it } from "vitest";
import { buildYouVsRoom, type AnalyticsYouVsRoom } from "../../lib/analytics-room";
import type { SeasonMemberGameweek } from "../../lib/gw-season";

function row(
  userId: string,
  gwNumber: number,
  overrides: Partial<SeasonMemberGameweek> = {},
): SeasonMemberGameweek {
  return {
    userId,
    gwNumber,
    entered: true,
    settled: true,
    points: 3,
    exacts: 1,
    correctPicks: 2,
    goalError: 3,
    countedFixtures: 3,
    ...overrides,
  };
}

describe("buildYouVsRoom", () => {
  it("returns null with no settled viewer window", () => {
    expect(buildYouVsRoom([], "u1")).toBeNull();
  });

  it("builds the four comparisons over the viewer's common window", () => {
    const result = buildYouVsRoom([
      row("u1", 1, { points: 3, exacts: 1, correctPicks: 2, goalError: 4, countedFixtures: 3 }),
      row("u1", 2, { points: 2, exacts: 0, correctPicks: 1, goalError: 5, countedFixtures: 3 }),
      row("u1", 3, { points: 1, exacts: 0, correctPicks: 1, goalError: 3, countedFixtures: 2 }),
      row("u2", 1, { points: 2, exacts: 0, correctPicks: 2, goalError: 6, countedFixtures: 3 }),
      row("u2", 2, { points: 5, exacts: 1, correctPicks: 2, goalError: 3, countedFixtures: 3 }),
      row("u2", 4, { points: 9, exacts: 3, correctPicks: 3, goalError: 0, countedFixtures: 3 }),
      row("u3", 2, { points: 1, exacts: 0, correctPicks: 1, goalError: 8, countedFixtures: 4 }),
    ], "u1");

    expect(result).not.toBeNull();
    const view = result as AnalyticsYouVsRoom;
    expect(view.windowGameweeks).toEqual([1, 2, 3]);
    expect(view.otherMemberCount).toBe(2);
    expect(view.metrics.exactRate.viewer).toBe(1 / 8);
    expect(view.metrics.exactRate.otherAverage).toBe((1 / 6 + 0) / 2);
    expect(view.metrics.resultRate.viewer).toBe(4 / 8);
    expect(view.metrics.avgGoalMiss.viewer).toBe(12 / 8);
    expect(view.metrics.last5Form.viewer).toBe(6 / 8);
    expect(view.exactRateBars.map((bar) => bar.userId)).toEqual(["u1", "u2", "u3"]);
  });

  it("computes each member bar from that member's fixtures and omits null data", () => {
    const result = buildYouVsRoom([
      row("testa", 1, { exacts: 2, countedFixtures: 5 }),
      row("testa", 2, { exacts: 2, countedFixtures: 5 }),
      row("testa", 3, { exacts: 1, countedFixtures: 5 }),
      row("testb", 1, { exacts: 0, countedFixtures: 5 }),
      row("testb", 2, { exacts: 0, countedFixtures: 5 }),
      row("testb", 3, { exacts: 0, countedFixtures: 5 }),
      row("testc", 1, { exacts: 2, countedFixtures: 5 }),
      row("testc", 2, { exacts: 2, countedFixtures: 5 }),
      row("testc", 3, { exacts: 1, countedFixtures: 5 }),
      row("testd", 1, { exacts: 1, countedFixtures: 5 }),
      row("testd", 2, { exacts: 1, countedFixtures: 5 }),
      row("testd", 3, { exacts: 2, countedFixtures: 5 }),
      row("ananth", 1, { countedFixtures: 0 }),
    ], "testa");

    expect(result?.exactRateBars).toEqual([
      { userId: "testa", rate: 5 / 15 },
      { userId: "testc", rate: 5 / 15 },
      { userId: "testd", rate: 4 / 15 },
      { userId: "testb", rate: 0 },
    ]);
    expect(result?.exactRateBars.some((bar) => bar.userId === "ananth")).toBe(false);
  });

  it("returns null without two other members with data in the window", () => {
    expect(buildYouVsRoom([row("u1", 1), row("u2", 1)], "u1")).toBeNull();
  });

  it("returns a one-gameweek comparison and excludes a dirty gameweek", () => {
    const result = buildYouVsRoom([
      row("u1", 1),
      row("u1", 2, { settled: false }),
      row("u2", 1),
      row("u3", 1),
    ], "u1");
    expect(result?.windowGameweeks).toEqual([1]);
    expect(result?.metrics.exactRate.viewer).toBe(1 / 3);
    expect(result?.excludedGameweeks).toEqual([2]);
  });

  it("uses only the viewer's window when a rival joins late", () => {
    const result = buildYouVsRoom([
      row("u1", 3, { points: 3 }),
      row("u1", 4, { points: 6 }),
      row("u2", 1, { points: 9 }),
      row("u2", 3, { points: 3 }),
      row("u3", 4, { points: 6 }),
    ], "u1");
    expect(result?.windowGameweeks).toEqual([3, 4]);
    expect(result?.otherMemberCount).toBe(2);
    expect(result?.metrics.last5Form.otherAverage).toBe(9 / 6);
  });

  it("uses stored counted fixtures after a partial void, not the full fixture count", () => {
    const result = buildYouVsRoom([
      row("u1", 1, { exacts: 1, countedFixtures: 2, goalError: 2 }),
      row("u2", 1, { exacts: 1, countedFixtures: 2, goalError: 4 }),
      row("u3", 1, { exacts: 0, countedFixtures: 2, goalError: 4 }),
    ], "u1");
    expect(result?.metrics.exactRate.viewer).toBe(1 / 2);
    expect(result?.metrics.avgGoalMiss.viewer).toBe(1);
  });

  it("hides the module instead of turning zero denominators into zero", () => {
    const result = buildYouVsRoom([
      row("u1", 1, { countedFixtures: 0 }),
      row("u2", 1),
      row("u3", 1),
    ], "u1");
    expect(result).toBeNull();
  });
});
