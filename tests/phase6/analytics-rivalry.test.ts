import { describe, expect, it } from "vitest";
import { buildRivalry, buildRivalryModule } from "../../lib/analytics-rivalry";
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
    points: 5,
    exacts: 1,
    correctPicks: 2,
    goalError: 8,
    countedFixtures: 3,
    ...overrides,
  };
}

describe("buildRivalry", () => {
  it("shows a one-gameweek settled record", () => {
    const record = buildRivalry([row("viewer", 1), row("rival", 1, { points: 4 })], "viewer", "rival");
    expect(record).toMatchObject({ won: 1, lost: 0, tied: 0, sharedGameweeks: 1, currentRunLength: 1, runOwner: "viewer" });
  });

  it("keeps an all-equal gameweek tied and breaks the current run", () => {
    const record = buildRivalry([
      row("viewer", 1, { points: 6 }),
      row("rival", 1, { points: 6 }),
    ], "viewer", "rival");
    expect(record).toMatchObject({ won: 0, lost: 0, tied: 1, currentRunLength: 0, runOwner: null });
  });

  it("uses the settlement tie-break chain and carries it into the current run", () => {
    const record = buildRivalry([
      row("viewer", 1, { points: 6, exacts: 2, goalError: 4 }),
      row("viewer", 2, { points: 5, exacts: 1, goalError: 9 }),
      row("viewer", 3, { points: 4, exacts: 1, goalError: 6 }),
      row("rival", 1, { points: 5, exacts: 1, goalError: 8 }),
      row("rival", 2, { points: 5, exacts: 1, goalError: 7 }),
      row("rival", 3, { points: 5, exacts: 1, goalError: 5 }),
    ], "viewer", "rival");

    expect(record).toMatchObject({
      won: 1,
      lost: 2,
      tied: 0,
      viewerExacts: 4,
      rivalExacts: 3,
      sharedGameweeks: 3,
      currentRunLength: 2,
      runOwner: "rival",
    });
  });

  it("excludes a gameweek either member did not enter", () => {
    const record = buildRivalry([
      row("viewer", 1),
      row("viewer", 2),
      row("rival", 1),
      row("rival", 2, { entered: false }),
    ], "viewer", "rival");
    expect(record?.sharedGameweeks).toBe(1);
    expect(record?.settledGameweeks).toBe(2);
    expect(record?.excludedGameweeks).toEqual([2]);
  });

  it("keeps a dirty or fully-void shared entry out of the record and names its gameweek", () => {
    const record = buildRivalry([
      row("viewer", 1),
      row("rival", 1),
      row("viewer", 2, { settled: false }),
      row("rival", 2, { settled: false }),
    ], "viewer", "rival");
    expect(record?.sharedGameweeks).toBe(1);
    expect(record?.excludedGameweeks).toEqual([2]);
  });

  it("returns null when there is no shared settled gameweek and omits that rival", () => {
    const rows = [row("viewer", 1), row("rival", 1, { entered: false })];
    expect(buildRivalry(rows, "viewer", "rival")).toBeNull();
    expect(
      buildRivalryModule(rows, "viewer", new Map([["rival", "Rival"]])),
    ).toBeNull();
  });

  it("sorts options by name and chooses the rival with the most shared weeks", () => {
    const rows = [
      row("viewer", 1), row("viewer", 2),
      row("rival-a", 1), row("rival-a", 2),
      row("rival-b", 1),
    ];
    const module = buildRivalryModule(
      rows,
      "viewer",
      new Map([
        ["rival-a", "Zoe"],
        ["rival-b", "Adam"],
      ]),
    );
    expect(module?.options.map((option) => option.name)).toEqual(["Adam", "Zoe"]);
    expect(module?.defaultRivalId).toBe("rival-a");
  });
});
