// Phase 3 — U15 provisional scoring via settleGameweek only (lib/gw-live.ts). Blind from §5.5
// U15 and T-U10: "five input shapes directly against engine output: zero-final, partial-final,
// partial-plus-void, all-final, and a score correction applied to a previously all-final input."
// Money from a provisional call must never reach the view layer.
//
// NAMING CAVEAT: no export name given beyond "lib/gw-live.ts builds one GwInput ... and calls
// settleGameweek once." Guessed `buildLiveOutcome(activeFixtures, voidFixtures, entries)` (or a
// close shape) returning the engine's GwOutcome (or a view-safe projection of it). A wrong guess
// fails on import, which is the intended signal.
import { describe, expect, it } from "vitest";
import { settleGameweek } from "../../lib/gameweek-settle";
import { buildLiveOutcome } from "../../lib/gw-live";

const entries = [
  { userId: "u1", picks: [{ fixtureId: "f1", predHome: 1, predAway: 0 }, { fixtureId: "f2", predHome: 2, predAway: 2 }] },
  { userId: "u2", picks: [{ fixtureId: "f1", predHome: 0, predAway: 0 }, { fixtureId: "f2", predHome: 1, predAway: 1 }] },
  { userId: "u3", picks: [{ fixtureId: "f1", predHome: 2, predAway: 0 }, { fixtureId: "f2", predHome: 0, predAway: 3 }] },
];

describe("buildLiveOutcome — T-U10 against the pure engine, five input shapes", () => {
  it("zero-final: no active fixture has a score yet — provisional call still resolves without throwing", () => {
    expect(() => buildLiveOutcome({ activeFixtures: [], voidFixtures: [], entries, stakeInr: 100 })).not.toThrow();
  });

  it("partial-final: one of two active fixtures final — matches settleGameweek called with only that fixture as a result", () => {
    const direct = settleGameweek({
      entries: entries.map((e) => ({ userId: e.userId, picks: e.picks.filter((p) => p.fixtureId === "f1") })),
      results: [{ fixtureId: "f1", state: "final", home: 1, away: 0 }],
      stakeInr: 100,
    });
    const live = buildLiveOutcome({
      activeFixtures: [{ fixtureId: "f1", final: true, home: 1, away: 0 }, { fixtureId: "f2", final: false }],
      voidFixtures: [],
      entries,
      stakeInr: 100,
    });
    if (direct.kind !== "settled" || live.kind !== "settled") throw new Error("expected both settled");
    expect(live.scores.map((s: any) => ({ userId: s.userId, points: s.points }))).toEqual(
      direct.scores.map((s) => ({ userId: s.userId, points: s.points })),
    );
  });

  it("partial-plus-void: void fixtures are part of the input, not an omission — engine sees them as void results", () => {
    const live = buildLiveOutcome({
      activeFixtures: [{ fixtureId: "f1", final: true, home: 1, away: 0 }],
      voidFixtures: ["f2"],
      entries,
      stakeInr: 100,
    });
    expect(live.kind).toBe("settled");
  });

  it("all-final: every active fixture final — matches settleGameweek on the full result set", () => {
    const results = [
      { fixtureId: "f1", state: "final" as const, home: 1, away: 0 },
      { fixtureId: "f2", state: "final" as const, home: 2, away: 2 },
    ];
    const direct = settleGameweek({ entries, results, stakeInr: 100 });
    const live = buildLiveOutcome({
      activeFixtures: [
        { fixtureId: "f1", final: true, home: 1, away: 0 },
        { fixtureId: "f2", final: true, home: 2, away: 2 },
      ],
      voidFixtures: [],
      entries,
      stakeInr: 100,
    });
    if (direct.kind !== "settled" || live.kind !== "settled") throw new Error("expected both settled");
    expect(live.winners).toEqual(direct.winners);
  });

  it("a score correction applied to a previously all-final input changes the live points, proving no caching of the first call", () => {
    const before = buildLiveOutcome({
      activeFixtures: [{ fixtureId: "f1", final: true, home: 1, away: 0 }],
      voidFixtures: [],
      entries,
      stakeInr: 100,
    });
    const after = buildLiveOutcome({
      activeFixtures: [{ fixtureId: "f1", final: true, home: 0, away: 0 }], // corrected scoreline
      voidFixtures: [],
      entries,
      stakeInr: 100,
    });
    if (before.kind !== "settled" || after.kind !== "settled") throw new Error("expected both settled");
    expect(before.scores).not.toEqual(after.scores);
  });

  it("provisional money is never returned to the view layer — the outcome carries no transfers/potInr visible to a caller that only asked for points", () => {
    const live = buildLiveOutcome({
      activeFixtures: [{ fixtureId: "f1", final: true, home: 1, away: 0 }, { fixtureId: "f2", final: true, home: 2, away: 2 }],
      voidFixtures: [],
      entries,
      stakeInr: 100,
      viewSafe: true,
    } as never);
    expect((live as any).transfers).toBeUndefined();
    expect((live as any).potInr).toBeUndefined();
  });
});
