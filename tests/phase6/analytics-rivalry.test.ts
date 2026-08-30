import { describe, expect, it } from "vitest";
import { buildRivalry, buildRivalryModule } from "../../lib/analytics-rivalry";
import type { CorpusEntryResult } from "../../lib/analytics-corpus-load";
import type { SeasonMemberGameweek } from "../../lib/gw-season";
import { emptyCorpus, settledFixture } from "../fixtures/analytics-corpus";

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

function entryResult(
  userId: string,
  gwNumber: number,
  perFixture: CorpusEntryResult["perFixture"],
): CorpusEntryResult {
  return { userId, gwNumber, points: 0, exacts: 0, goalError: 0, perFixture };
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

  it("selects the largest shared-fixture gap from stored points", () => {
    const rows = [
      row("viewer", 1),
      row("rival", 1),
      row("viewer", 2),
      row("rival", 2),
    ];
    const corpus = emptyCorpus({
      gameweeks: [
        { gwNumber: 1, entrantIds: ["viewer", "rival"] },
        { gwNumber: 2, entrantIds: ["viewer", "rival"] },
      ],
      fixtures: [
        settledFixture("smaller", 1),
        settledFixture("largest", 2),
      ],
      results: [
        entryResult("viewer", 1, [{ fixtureId: "smaller", verdict: "exact", pts: 3 }]),
        entryResult("rival", 1, [{ fixtureId: "smaller", verdict: "result", pts: 1 }]),
        entryResult("viewer", 2, [{ fixtureId: "largest", verdict: "miss", pts: 0 }]),
        entryResult("rival", 2, [{ fixtureId: "largest", verdict: "exact", pts: 3 }]),
      ],
    });

    expect(buildRivalry(rows, "viewer", "rival", corpus)?.biggestSwing).toEqual({
      gwNumber: 2,
      fixtureId: "largest",
      homeShort: "HOM",
      awayShort: "AWY",
      ftHome: 2,
      ftAway: 1,
      viewerPts: 0,
      rivalPts: 3,
    });
  });

  it("breaks equal swing gaps by later gameweek, then fixture id", () => {
    const rows = [row("viewer", 1), row("rival", 1), row("viewer", 2), row("rival", 2)];
    const corpus = emptyCorpus({
      fixtures: [
        settledFixture("zulu", 1),
        settledFixture("zulu", 2),
        settledFixture("alpha", 2),
      ],
      results: [
        entryResult("viewer", 1, [{ fixtureId: "zulu", verdict: "exact", pts: 3 }]),
        entryResult("rival", 1, [{ fixtureId: "zulu", verdict: "miss", pts: 0 }]),
        entryResult("viewer", 2, [
          { fixtureId: "zulu", verdict: "exact", pts: 3 },
          { fixtureId: "alpha", verdict: "exact", pts: 3 },
        ]),
        entryResult("rival", 2, [
          { fixtureId: "zulu", verdict: "miss", pts: 0 },
          { fixtureId: "alpha", verdict: "miss", pts: 0 },
        ]),
      ],
    });

    expect(buildRivalry(rows, "viewer", "rival", corpus)?.biggestSwing?.fixtureId).toBe("alpha");
  });

  it("returns no swing when all shared fixture points are equal", () => {
    const corpus = emptyCorpus({
      fixtures: [settledFixture("equal", 1)],
      results: [
        entryResult("viewer", 1, [{ fixtureId: "equal", verdict: "result", pts: 1 }]),
        entryResult("rival", 1, [{ fixtureId: "equal", verdict: "result", pts: 1 }]),
      ],
    });

    expect(buildRivalry([row("viewer", 1), row("rival", 1)], "viewer", "rival", corpus)?.biggestSwing).toBeNull();
  });

  it("never selects a fixture from a non-shared gameweek", () => {
    const rows = [
      row("viewer", 1),
      row("rival", 1),
      row("viewer", 2),
      row("rival", 2, { entered: false }),
    ];
    const corpus = emptyCorpus({
      fixtures: [settledFixture("shared", 1), settledFixture("not-shared", 2)],
      results: [
        entryResult("viewer", 1, [{ fixtureId: "shared", verdict: "result", pts: 1 }]),
        entryResult("rival", 1, [{ fixtureId: "shared", verdict: "miss", pts: 0 }]),
        entryResult("viewer", 2, [{ fixtureId: "not-shared", verdict: "exact", pts: 3 }]),
        entryResult("rival", 2, [{ fixtureId: "not-shared", verdict: "miss", pts: 0 }]),
      ],
    });

    expect(buildRivalry(rows, "viewer", "rival", corpus)?.biggestSwing?.fixtureId).toBe("shared");
  });

  it.each(["viewer", "rival"] as const)(
    "disqualifies a fixture when the %s verdict is void",
    (voidSide) => {
      const corpus = emptyCorpus({
        fixtures: [settledFixture("valid", 1), settledFixture("voided", 1)],
        results: [
          entryResult("viewer", 1, [
            { fixtureId: "valid", verdict: "result", pts: 1 },
            { fixtureId: "voided", verdict: voidSide === "viewer" ? "void" : "exact", pts: voidSide === "viewer" ? 0 : 3 },
          ]),
          entryResult("rival", 1, [
            { fixtureId: "valid", verdict: "miss", pts: 0 },
            { fixtureId: "voided", verdict: voidSide === "rival" ? "void" : "miss", pts: 0 },
          ]),
        ],
      });

      expect(buildRivalry([row("viewer", 1), row("rival", 1)], "viewer", "rival", corpus)?.biggestSwing?.fixtureId).toBe("valid");
    },
  );

  it("leaves biggestSwing null when the corpus argument is omitted", () => {
    const rows = [row("viewer", 1), row("rival", 1)];

    expect(buildRivalry(rows, "viewer", "rival")?.biggestSwing).toBeNull();
    expect(buildRivalryModule(rows, "viewer", new Map([ ["rival", "Rival"] ]))?.byRivalId.rival.biggestSwing).toBeNull();
  });
});
