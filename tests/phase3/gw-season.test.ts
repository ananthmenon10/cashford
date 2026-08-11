// Phase 3 — §7 Season tab pure logic (lib/gw-season.ts). Blind from §7, T-U20-T-U24, T-U20a, T-U24a.
//
// NAMING CAVEAT: the plan describes the Season tab's two panes (U24-U26a) and its tests
// (T-U20-T-U24) but names no pure module/export for the row-building and running-totals logic —
// only components (`SeasonTable`) which this brief instructs me to test at the pure-logic layer,
// not by rendering. Guessed `lib/gw-season.ts` exporting `buildSeasonRows(gws, viewerId)` (per-
// gameweek rows, D8 retains departed members by name) and `buildRunningTotals(rows)` (D7a
// gameweeks-entered counting void gameweeks; PR3b dirty suppression per U26a). A wrong guess
// fails on import, which is the intended signal.
import { describe, expect, it } from "vitest";
import { buildRunningTotals, buildSeasonRows, snapshotStats } from "../../lib/gw-season";

// Real version pair per R-1 (F2/F9): "dirty" is derived from inputVersion > settledVersion via
// isGameweekResultDirty (lib/net-balance.ts), not an invented boolean. Default pair (1, 1) is
// not dirty (equal, not greater); pass `dirty()` for a row whose input has moved past settlement.
function dirty() {
  return { inputVersion: 2, settledVersion: 1 };
}

function gwRow(overrides: Record<string, unknown> = {}) {
  return {
    gwNumber: 1,
    status: "settled",
    entryStatus: "locked_in",
    points: 6,
    exacts: 2,
    countedFixtures: 6,
    correctPicks: 2,
    incorrectPicks: 4,
    voidPicks: 0,
    netInr: 200,
    inputVersion: 1,
    settledVersion: 1,
    isVoid: false,
    ...overrides,
  };
}

describe("buildSeasonRows — U25 departed members retained with history", () => {
  it("a departed member's historical rows are still returned, unaffected by their leave date", () => {
    const rows = buildSeasonRows([gwRow({ gwNumber: 1 })], "departed-user");
    expect(rows.length).toBe(1);
  });

  it("T-U20 rows link to ?gw=<number> on the Gameweek tab (a per-row navigable field, not a rendered anchor)", () => {
    const rows = buildSeasonRows([gwRow({ gwNumber: 24 })], "u1");
    expect(rows[0]).toHaveProperty("gwNumber", 24);
  });
});

describe("buildRunningTotals — U26/U26a running totals + dirty suppression", () => {
  it("T-U20a: a void gameweek with a locked_in entry still increments gameweeks-entered (D7a)", () => {
    const totals = buildRunningTotals([
      gwRow({ gwNumber: 1, isVoid: true, entryStatus: "locked_in", points: 0, netInr: 0 }),
      gwRow({ gwNumber: 2, entryStatus: "locked_in" }),
    ]);
    expect(totals.gameweeksEntered).toBe(2);
  });

  it("U26: money is signed, points are not, in the aggregate totals", () => {
    const totals = buildRunningTotals([
      gwRow({ gwNumber: 1, netInr: -200 }),
      gwRow({ gwNumber: 2, netInr: 600 }),
    ]);
    expect(totals.netInr).toBe(400);
    expect(totals.points).toBeGreaterThanOrEqual(0);
  });

  it("T-U24a: a dirty row suppresses its own money AND the running total's money it feeds into", () => {
    const totals = buildRunningTotals([
      gwRow({ gwNumber: 1, ...dirty(), netInr: 200 }),
      gwRow({ gwNumber: 2, netInr: 300 }),
    ]);
    expect(totals.netInr).toBe("suppressed");
  });

  it("U26a: a dirty row's points still render (computed the PR3a way) when computable, unlike money", () => {
    const totals = buildRunningTotals([gwRow({ gwNumber: 1, ...dirty(), points: 6, netInr: 200 })]);
    expect(totals.netInr).toBe("suppressed");
    expect(totals.points).toBe(6);
  });

  it("U26a: when a dirty gameweek's own points are not computable, its points cell is suppressed too, not carried from the superseded snapshot", () => {
    const totals = buildRunningTotals([gwRow({ gwNumber: 1, ...dirty(), points: null, netInr: 200 })]);
    expect(totals.points).not.toBe(6); // never the stale snapshot value
  });
});

describe("snapshotStats — derives countedFixtures/correctPicks/incorrectPicks/voidPicks from per_fixture jsonb", () => {
  it("counts a clean settled snapshot's per_fixture verdicts correctly", () => {
    const stats = snapshotStats(
      {
        per_fixture: [
          { verdict: "exact" },
          { verdict: "result" },
          { verdict: "miss" },
          { verdict: "void" },
        ],
      },
      "settled",
      false,
    );
    expect(stats).toEqual({
      countedFixtures: 3,
      correctPicks: 2,
      incorrectPicks: 1,
      voidPicks: 1,
    });
  });

  it("returns null (not zero) when per_fixture is null or missing", () => {
    expect(snapshotStats({ per_fixture: null }, "settled", false)).toBeNull();
    expect(snapshotStats({}, "settled", false)).toBeNull();
  });

  it("returns null when per_fixture is malformed jsonb (not an array)", () => {
    expect(snapshotStats({ per_fixture: "not-an-array" }, "settled", false)).toBeNull();
    expect(snapshotStats({ per_fixture: {} }, "settled", false)).toBeNull();
  });

  it("returns null for the whole snapshot when any verdict is outside the known union, not a partial count", () => {
    const stats = snapshotStats(
      { per_fixture: [{ verdict: "exact" }, { verdict: "pending" }] },
      "settled",
      false,
    );
    expect(stats).toBeNull();
    expect(stats).not.toEqual({
      countedFixtures: 2,
      correctPicks: 1,
      incorrectPicks: 0,
      voidPicks: 0,
    });
  });

  it("gates out a dirty row even with a valid per_fixture array", () => {
    const stats = snapshotStats(
      { per_fixture: [{ verdict: "exact" }, { verdict: "miss" }] },
      "settled",
      true,
    );
    expect(stats).toBeNull();
  });
});
