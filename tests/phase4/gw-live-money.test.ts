import { describe, expect, it } from "vitest";
import { buildLiveInput } from "../../lib/gw-live-money";
import { gameweekNets, settleGameweek } from "../../lib/gameweek-settle";
import { entry, pick } from "./helpers";

const entries = [
  entry("alice", [pick("fx-1", 2, 1), pick("fx-2", 1, 1)]),
  entry("bob", [pick("fx-1", 1, 0), pick("fx-2", 2, 0)]),
];

describe("live money input", () => {
  it("returns null before any scored fixture starts and for void-only input", () => {
    expect(
      buildLiveInput({
        entries,
        fixtures: [
          {
            fixtureId: "fx-1",
            state: "upcoming",
            home: null,
            away: null,
          },
        ],
        stakeInr: 100,
      }),
    ).toBeNull();
    expect(
      buildLiveInput({
        entries,
        fixtures: [
          {
            fixtureId: "fx-1",
            state: "void",
            home: null,
            away: null,
          },
        ],
        stakeInr: 100,
      }),
    ).toBeNull();
  });

  it("counts a live 0-0 as a final score snapshot", () => {
    const input = buildLiveInput({
      entries,
      fixtures: [
        { fixtureId: "fx-1", state: "live", home: 0, away: 0 },
        {
          fixtureId: "fx-2",
          state: "upcoming",
          home: null,
          away: null,
        },
      ],
      stakeInr: 100,
    });
    expect(input?.results).toEqual([
      { fixtureId: "fx-1", state: "final", home: 0, away: 0 },
    ]);
  });

  it("M-1: builds a snapshot mixing live, finished and omitted-upcoming fixtures", () => {
    const input = buildLiveInput({
      entries,
      fixtures: [
        { fixtureId: "fx-1", state: "final", home: 2, away: 1 },
        { fixtureId: "fx-2", state: "live", home: 1, away: 1 },
        { fixtureId: "fx-3", state: "upcoming", home: null, away: null },
      ],
      stakeInr: 100,
    });
    expect(input?.results).toEqual([
      { fixtureId: "fx-1", state: "final", home: 2, away: 1 },
      { fixtureId: "fx-2", state: "final", home: 1, away: 1 },
    ]);
    // no-throw: calling the real engine over this live snapshot never throws.
    expect(() => settleGameweek(input!)).not.toThrow();
  });

  it("net-zero invariant: money nets across all entries always sum to zero", () => {
    const input = buildLiveInput({
      entries,
      fixtures: [
        { fixtureId: "fx-1", state: "final", home: 2, away: 1 },
        { fixtureId: "fx-2", state: "final", home: 1, away: 1 },
      ],
      stakeInr: 100,
    })!;
    const outcome = settleGameweek(input);
    expect(outcome.kind).toBe("settled");
    if (outcome.kind !== "settled") throw new Error("unreachable");
    const nets = gameweekNets(outcome);
    const total = [...nets.values()].reduce((sum, net) => sum + net, 0);
    expect(total).toBe(0);
  });

  it("matches a hand-built all-final engine input", () => {
    const input = buildLiveInput({
      entries,
      fixtures: [
        { fixtureId: "fx-1", state: "final", home: 2, away: 1 },
        { fixtureId: "fx-2", state: "final", home: 1, away: 1 },
      ],
      stakeInr: 100,
    })!;
    expect(settleGameweek(input)).toEqual(
      settleGameweek({
        entries,
        results: [
          { fixtureId: "fx-1", state: "final", home: 2, away: 1 },
          { fixtureId: "fx-2", state: "final", home: 1, away: 1 },
        ],
        stakeInr: 100,
      }),
    );
  });
});
