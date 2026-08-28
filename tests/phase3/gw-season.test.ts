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
import {
  buildRunningTotals,
  buildSeasonRows,
  loadSeasonView,
  projectMemberGameweeks,
  snapshotStats,
  type SeasonInputRow,
} from "../../lib/gw-season";
import type { LeagueIdentity } from "../../lib/gw-view";

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

type Verdict = "exact" | "result" | "miss" | "void";

function snapshotRow(
  gwNumber: number,
  verdicts: readonly Verdict[],
  overrides: Record<string, unknown> = {},
) {
  const snapshot = { per_fixture: verdicts.map((verdict) => ({ verdict })) };
  const stats = snapshotStats(snapshot, "settled", false);
  return gwRow({
    gwNumber,
    outcome: "settled",
    ...(stats ?? {}),
    ...overrides,
  });
}

function fakeSeasonReader(tables: Record<string, readonly Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const rows = () =>
        (tables[table] ?? []).filter((row) => filters.every((matches) => matches(row)));
      const chain: any = {
        select: () => chain,
        eq: (field: string, value: unknown) => {
          filters.push((row) => row[field] === value);
          return chain;
        },
        in: (field: string, values: readonly unknown[]) => {
          filters.push((row) => values.includes(row[field]));
          return chain;
        },
        order: () => chain,
        then: (resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
      };
      return chain;
    },
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

  it("Phase B: aggregates correct, incorrect, void, and counted fixtures from one settled snapshot", () => {
    const totals = buildRunningTotals([
      snapshotRow(1, [
        "exact",
        "exact",
        "exact",
        "result",
        "result",
        "result",
        "result",
        "miss",
        "miss",
        "void",
      ]),
    ]);
    expect(totals.correctPicks).toBe(7);
    expect(totals.incorrectPicks).toBe(2);
    expect(totals.voidPicks).toBe(1);
    expect(totals.countedFixtures).toBe(9);
  });

  it("Phase B: sums the four snapshot counters across settled gameweeks", () => {
    const totals = buildRunningTotals([
      snapshotRow(1, ["exact", "result", "miss", "void"]),
      snapshotRow(2, ["exact", "result", "result", "miss", "miss", "void"]),
    ]);
    expect(totals.correctPicks).toBe(5);
    expect(totals.incorrectPicks).toBe(3);
    expect(totals.voidPicks).toBe(2);
    expect(totals.countedFixtures).toBe(8);
  });

  it("C1: keeps the stored goal-error total alongside the snapshot counters", () => {
    const totals = buildRunningTotals([
      snapshotRow(1, ["result", "miss"], { goalError: 4 }),
      snapshotRow(2, ["exact", "miss"], { goalError: 7 }),
    ]);
    expect(totals.goalError).toBe(11);
  });

  it("Phase B: keeps the score scale identity between points, exacts, and correct picks", () => {
    const verdicts: Verdict[] = [
      "exact",
      "exact",
      "exact",
      "result",
      "result",
      "result",
      "result",
      "miss",
      "miss",
      "void",
    ];
    const snapshot = { per_fixture: verdicts.map((verdict) => ({ verdict })) };
    const stats = snapshotStats(snapshot, "settled", false)!;
    const totals = buildRunningTotals([
      gwRow({
        outcome: "settled",
        ...stats,
        points: 13,
        exacts: 3,
      }),
    ]);
    expect(totals.correctPicks).toBe(
      (totals.points as number) - 2 * totals.exacts,
    );
  });

  it("Phase B: a fully void gameweek contributes no snapshot data", () => {
    const totals = buildRunningTotals([
      gwRow({
        outcome: "void",
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
      }),
    ]);
    expect(totals.correctPicks).toBeNull();
    expect(totals.incorrectPicks).toBeNull();
    expect(totals.voidPicks).toBeNull();
    expect(totals.countedFixtures).toBeNull();
  });

  it("Phase B: counts partial voids separately from correct, incorrect, and counted picks", () => {
    const totals = buildRunningTotals([
      snapshotRow(1, ["exact", "result", "miss", "void", "void"]),
    ]);
    expect(totals.correctPicks).toBe(2);
    expect(totals.incorrectPicks).toBe(1);
    expect(totals.voidPicks).toBe(2);
    expect(totals.countedFixtures).toBe(3);
  });

  it("Phase B: no entered rows keep all snapshot counters null", () => {
    const totals = buildRunningTotals([]);
    expect(totals.correctPicks).toBeNull();
    expect(totals.incorrectPicks).toBeNull();
    expect(totals.voidPicks).toBeNull();
    expect(totals.countedFixtures).toBeNull();
  });

  it("Phase B: any dirty gameweek suppresses all snapshot counters and net", () => {
    const totals = buildRunningTotals([
      snapshotRow(1, ["exact", "result", "miss", "void"], {
        ...dirty(),
        netInr: 200,
      }),
    ]);
    expect(totals.correctPicks).toBe("suppressed");
    expect(totals.incorrectPicks).toBe("suppressed");
    expect(totals.voidPicks).toBe("suppressed");
    expect(totals.countedFixtures).toBe("suppressed");
    expect(totals.netInr).toBe("suppressed");
  });

  it("Phase B: an empty per_fixture snapshot is unusable rather than a zero record", () => {
    expect(snapshotStats({ per_fixture: [] }, "settled", false)).toBeNull();
    const totals = buildRunningTotals([
      gwRow({
        outcome: "settled",
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
      }),
    ]);
    expect(totals.correctPicks).toBeNull();
    expect(totals.incorrectPicks).toBeNull();
    expect(totals.voidPicks).toBeNull();
    expect(totals.countedFixtures).toBeNull();
  });

  it("Phase B: an unknown verdict makes the whole snapshot unusable", () => {
    const stats = snapshotStats(
      { per_fixture: [{ verdict: "exact" }, { verdict: "unknown" }] },
      "settled",
      false,
    );
    expect(stats).toBeNull();
    const totals = buildRunningTotals([
      gwRow({
        outcome: "settled",
        countedFixtures: stats?.countedFixtures ?? null,
        correctPicks: stats?.correctPicks ?? null,
        incorrectPicks: stats?.incorrectPicks ?? null,
        voidPicks: stats?.voidPicks ?? null,
      }),
    ]);
    expect(totals.correctPicks).toBeNull();
    expect(totals.incorrectPicks).toBeNull();
    expect(totals.voidPicks).toBeNull();
    expect(totals.countedFixtures).toBeNull();
  });
});

describe("projectMemberGameweeks — the slim analytics projection", () => {
  it("keeps stored settled counters and goal error for a locked entrant", () => {
    const row = snapshotRow(4, ["exact", "result", "miss"], {
      points: 4,
      exacts: 1,
      goalError: 5,
    }) as SeasonInputRow;
    expect(projectMemberGameweeks(new Map([["u1", [row]]]))).toEqual([
      {
        userId: "u1",
        gwNumber: 4,
        entered: true,
        settled: true,
        points: 4,
        exacts: 1,
        correctPicks: 2,
        goalError: 5,
        countedFixtures: 3,
      },
    ]);
  });

  it("hides all snapshot values for a dirty or void gameweek instead of carrying stale numbers", () => {
    const dirtyRow = snapshotRow(2, ["exact"], { ...dirty(), goalError: 1 }) as SeasonInputRow;
    const voidRow = snapshotRow(3, ["void"], {
      outcome: "void",
      countedFixtures: null,
      correctPicks: null,
      goalError: null,
    }) as SeasonInputRow;
    const rows = projectMemberGameweeks(new Map([["u1", [dirtyRow, voidRow]]]));
    expect(rows).toEqual([
      expect.objectContaining({ gwNumber: 2, entered: true, settled: false, points: null, exacts: null, correctPicks: null, goalError: null, countedFixtures: null }),
      expect.objectContaining({ gwNumber: 3, entered: true, settled: false, points: null, exacts: null, correctPicks: null, goalError: null, countedFixtures: null }),
    ]);
  });

  it("marks a non-locked entry as not entered while retaining the settled gameweek boundary", () => {
    const row = snapshotRow(5, ["result"], { entryStatus: "entered", points: 1, exacts: 0, goalError: 2 }) as SeasonInputRow;
    expect(projectMemberGameweeks(new Map([["u1", [row]]]))[0]).toEqual({
      userId: "u1",
      gwNumber: 5,
      entered: false,
      settled: true,
      points: null,
      exacts: null,
      correctPicks: 1,
      goalError: 2,
      countedFixtures: 1,
    });
  });
});

describe("loadSeasonView dues order", () => {
  it("orders every league member by all-time dues and keeps shared ranks", async () => {
    const memberRows = [
      { league_id: "league-1", user_id: "a-viewer" },
      { league_id: "league-1", user_id: "m-vishwa" },
      { league_id: "league-1", user_id: "no-entry" },
      { league_id: "league-1", user_id: "z-rishi" },
      { league_id: "league-1", user_id: "never-played" },
    ];
    const entries = ["a-viewer", "m-vishwa", "z-rishi"].map((userId) => ({
      id: `entry-${userId}`,
      gameweek_contest_id: "contest-1",
      user_id: userId,
      status: "locked_in",
      profiles: { display_name: userId, username: userId },
    }));
    const entryResults = [
      { userId: "a-viewer", netInr: 100, points: 10 },
      { userId: "m-vishwa", netInr: 100, points: 0 },
      { userId: "z-rishi", netInr: 300, points: 10 },
    ].map((row) => ({
      entry_id: `entry-${row.userId}`,
      gameweek_contest_id: "contest-1",
      points: row.points,
      exacts: 0,
      goal_error: 0,
      net_inr: row.netInr,
      is_winner: row.userId === "z-rishi",
      per_fixture: [{ verdict: row.points > 0 ? "result" : "miss" }],
      gameweek_entries: { user_id: row.userId },
      "gameweek_entries.league_id": "league-1",
    }));
    const reader = fakeSeasonReader({
      gameweek_contests: [{
        id: "contest-1",
        league_id: "league-1",
        gameweek_id: "gw-1",
        competition_id: "competition-1",
        status: "settled",
        deadline_at: "2026-07-31T12:00:00.000Z",
        input_version: 1,
        gameweek_results: [{ settled_version: 1 }],
      }],
      gameweeks: [{
        id: "gw-1",
        competition_id: "competition-1",
        number: 1,
        name: "Gameweek 1",
        status: "locked",
        deadline_at: "2026-07-31T12:00:00.000Z",
      }],
      member_competitions: memberRows.map(({ user_id }) => ({
        league_id: "league-1",
        competition_id: "competition-1",
        user_id,
      })),
      league_members: memberRows,
      gameweek_results: [{
        gameweek_contest_id: "contest-1",
        outcome: "settled",
        settled_version: 1,
        void_reason: null,
      }],
      gameweek_entries: entries,
      gameweek_entry_results: entryResults,
      contest_results: [{
        user_id: "no-entry",
        net_inr: 500,
        "contests.league_id": "league-1",
      }],
    });
    const identity: LeagueIdentity = {
      league: {
        id: "league-1",
        name: "Friends",
        slug: "friends",
        createdBy: "a-viewer",
        status: "active",
      },
      participation: {
        status: "active",
        format: "gameweek",
        competitionId: "competition-1",
        competitionName: "Premier League",
        competitionSlug: "pl-2026-27",
        eligibleFromGameweekId: null,
      },
    };

    const view = await loadSeasonView(
      reader as never,
      reader as never,
      identity,
      "a-viewer",
    );

    expect(view.totals.map((row) => row.userId)).toEqual([
      "no-entry",
      "z-rishi",
      "a-viewer",
      "m-vishwa",
      "never-played",
    ]);
    // A member with no settled result anywhere sits last and carries no rank.
    expect(view.totals.map((row) => row.rank)).toEqual([1, 2, 3, 3, null]);
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
