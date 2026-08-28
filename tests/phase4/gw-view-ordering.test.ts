import { describe, expect, it } from "vitest";
import { loadGameweekView, type LeagueIdentity } from "../../lib/gw-view";

type Row = Record<string, unknown>;

function fakeReader(tables: Record<string, readonly Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((matches) => matches(row)));
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
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
      };
      return chain;
    },
  };
}

const IDENTITY: LeagueIdentity = {
  league: {
    id: "league-1",
    name: "Friends",
    slug: "friends",
    createdBy: "viewer",
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

const NOW = new Date("2026-08-01T00:00:00.000Z");

function fixtureRow(
  fixtureId: string,
  kickoffAt: string | null,
  externalId?: number | null,
): Row {
  return {
    id: `membership-${fixtureId}`,
    gameweek_id: "gw-1",
    fixture_id: fixtureId,
    state: "active",
    void_reason: null,
    fixtures: {
      id: fixtureId,
      external_id: externalId,
      kickoff_at: kickoffAt,
      status: "scheduled",
      minute: null,
      ft_home: null,
      ft_away: null,
      home_team: { name: `Home ${fixtureId}`, short_name: `H ${fixtureId}` },
      away_team: { name: `Away ${fixtureId}`, short_name: `A ${fixtureId}` },
    },
  };
}

async function loadWithFixtures(rows: readonly Row[]) {
  const reader = fakeReader({
    gameweek_contests: [{
      id: "contest-1",
      league_id: "league-1",
      gameweek_id: "gw-1",
      competition_id: "competition-1",
      status: "open",
      stake_inr: 100,
      deadline_at: "2026-08-10T12:00:00.000Z",
      input_version: 1,
      gameweek_results: [],
    }],
    gameweeks: [{
      id: "gw-1",
      competition_id: "competition-1",
      number: 1,
      name: "Gameweek 1",
      status: "open",
      deadline_at: "2026-08-10T12:00:00.000Z",
    }],
    gameweek_fixtures: rows,
    gameweek_entry_results: [],
    member_competitions: [],
    gameweek_entries: [],
    gameweek_picks: [],
    profiles: [],
  });

  return loadGameweekView(
    reader as never,
    reader as never,
    IDENTITY,
    "viewer",
    undefined,
    NOW,
    false,
  );
}

async function loadWithGridFixtures(rows: readonly Row[]) {
  const reader = fakeReader({
    gameweek_contests: [{
      id: "contest-1",
      league_id: "league-1",
      gameweek_id: "gw-1",
      competition_id: "competition-1",
      status: "locked",
      stake_inr: 100,
      deadline_at: "2026-07-31T12:00:00.000Z",
      input_version: 1,
      gameweek_results: [],
    }],
    gameweeks: [{
      id: "gw-1",
      competition_id: "competition-1",
      number: 1,
      name: "Gameweek 1",
      status: "locked",
      deadline_at: "2026-07-31T12:00:00.000Z",
    }],
    gameweek_fixtures: rows,
    gameweek_entry_results: [],
    member_competitions: [{ user_id: "viewer", left_at: null }],
    gameweek_entries: [{
      id: "entry-1",
      user_id: "viewer",
      status: "locked_in",
      profiles: { display_name: "Viewer", username: "viewer" },
    }],
    gameweek_picks: [],
    profiles: [],
  });

  return loadGameweekView(
    reader as never,
    reader as never,
    IDENTITY,
    "viewer",
    undefined,
    NOW,
    false,
  );
}

async function loadCl6WithGrid() {
  const settledResult = {
    gameweek_contest_id: "contest-1",
    outcome: "settled",
    settled_version: 1,
    void_reason: null,
    tiebreak_used: "none",
  };
  const entry = {
    id: "entry-1",
    gameweek_contest_id: "contest-1",
    user_id: "viewer",
    status: "locked_in",
    profiles: { display_name: "Viewer", username: "viewer" },
  };
  const pick = {
    entry_id: "entry-1",
    fixture_id: "fixture-current",
    pred_home: 2,
    pred_away: 1,
    "gameweek_entries.gameweek_contest_id": "contest-1",
    gameweek_entries: { user_id: "viewer", gameweek_contest_id: "contest-1" },
  };
  const reader = fakeReader({
    gameweek_contests: [{
      id: "contest-1",
      league_id: "league-1",
      gameweek_id: "gw-1",
      competition_id: "competition-1",
      status: "settled",
      stake_inr: 100,
      deadline_at: "2026-07-31T12:00:00.000Z",
      input_version: 2,
      gameweek_results: [settledResult],
    }],
    gameweeks: [{
      id: "gw-1",
      competition_id: "competition-1",
      number: 1,
      name: "Gameweek 1",
      status: "locked",
      deadline_at: "2026-07-31T12:00:00.000Z",
    }],
    gameweek_fixtures: [{
      ...fixtureRow("fixture-current", "2026-07-31T13:00:00.000Z", 1),
      fixtures: {
        ...(fixtureRow("fixture-current", "2026-07-31T13:00:00.000Z", 1).fixtures as Row),
        status: "finished",
        ft_home: 1,
        ft_away: 0,
      },
    }],
    gameweek_results: [settledResult],
    gameweek_entry_results: [{
      entry_id: "entry-1",
      gameweek_contest_id: "contest-1",
      points: 7,
      exacts: 1,
      goal_error: 0,
      net_inr: 100,
      is_winner: true,
      per_fixture: [{ fixtureId: "fixture-current", pts: 3, verdict: "exact" }],
      gameweek_entries: { user_id: "viewer", status: "locked_in", profiles: entry.profiles },
    }],
    member_competitions: [{ user_id: "viewer", left_at: null }],
    gameweek_entries: [entry],
    gameweek_picks: [pick],
    profiles: [],
  });

  return loadGameweekView(
    reader as never,
    reader as never,
    IDENTITY,
    "viewer",
    undefined,
    NOW,
    false,
  );
}

describe("loadGameweekView fixture ordering", () => {
  it("returns deliberately unsorted fixtures in ascending kickoff order", async () => {
    const view = await loadWithFixtures([
      fixtureRow("fixture-late", "2026-08-04T12:00:00.000Z", 40),
      fixtureRow("fixture-early", "2026-08-01T12:00:00.000Z", 10),
      fixtureRow("fixture-middle", "2026-08-03T12:00:00.000Z", 30),
    ]);

    expect(view.fixtures.map((fixture) => fixture.fixtureId)).toEqual([
      "fixture-early",
      "fixture-middle",
      "fixture-late",
    ]);
  });

  it("uses external_id first and fixture id when external ids are equal", async () => {
    const view = await loadWithFixtures([
      fixtureRow("fixture-external-high", "2026-08-02T12:00:00.000Z", 20),
      fixtureRow("fixture-equal-z", "2026-08-02T12:00:00.000Z", 7),
      fixtureRow("fixture-external-low", "2026-08-02T12:00:00.000Z", 3),
      fixtureRow("fixture-equal-a", "2026-08-02T12:00:00.000Z", 7),
    ]);

    expect(view.fixtures.map((fixture) => fixture.fixtureId)).toEqual([
      "fixture-external-high",
      "fixture-external-low",
      "fixture-equal-a",
      "fixture-equal-z",
    ]);
  });

  it("falls back to fixture id for missing external ids and puts invalid kickoffs last", async () => {
    const view = await loadWithFixtures([
      fixtureRow("fixture-b-missing", null, null),
      fixtureRow("fixture-z-dated", "2026-08-02T12:00:00.000Z", null),
      fixtureRow("fixture-a-invalid", "not-a-date", null),
    ]);

    expect(view.fixtures.map((fixture) => fixture.fixtureId)).toEqual([
      "fixture-z-dated",
      "fixture-a-invalid",
      "fixture-b-missing",
    ]);
  });

  it("uses the same kickoff comparator for the point-grid rows", async () => {
    const view = await loadWithGridFixtures([
      fixtureRow("fixture-late", "2026-08-04T12:00:00.000Z", 40),
      fixtureRow("fixture-equal-z", "2026-08-02T12:00:00.000Z", 7),
      fixtureRow("fixture-equal-a", "2026-08-02T12:00:00.000Z", 7),
      fixtureRow("fixture-early", "2026-08-01T12:00:00.000Z", 10),
    ].map((row) => ({
      ...row,
      fixtures: {
        ...(row.fixtures as Row),
        status: "finished",
        ft_home: 1,
        ft_away: 0,
      },
    })));

    expect(view.pointGrid?.rows.map((row) => row.fixture.fixtureId)).toEqual([
      "fixture-early",
      "fixture-equal-a",
      "fixture-equal-z",
      "fixture-late",
    ]);
  });

  it("uses the settled snapshot for CL6 grids instead of recomputing current scores", async () => {
    const view = await loadCl6WithGrid();

    expect(view.lifecycle).toBe("CL6");
    expect(view.pointGrid?.entrants[0]?.totalPoints).toBe(7);
    expect(view.pointGrid?.rows[0]?.cells[0]).toEqual({
      pick: [2, 1],
      points: 3,
      verdict: "exact",
    });
  });
});
