import { describe, expect, it } from "vitest";
import { loadSeasonPickCorpus, type SeasonPickCorpus } from "../../lib/analytics-corpus-load";

const leagueId = "league-1";
const competitionId = "competition-1";

type Call = { table: string; method: string; args: unknown[] };

function fixtureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "membership-1",
    gameweek_id: "gw-1",
    fixture_id: "fixture-1",
    state: "active",
    void_reason: null,
    fixtures: {
      id: "fixture-1",
      competition_id: competitionId,
      ft_home: 2,
      ft_away: 1,
      home_team_id: "team-home",
      away_team_id: "team-away",
      home_label: "Home FC",
      away_label: "Away FC",
      home_team: { id: "team-home", name: "Home FC", short_name: "HOM" },
      away_team: { id: "team-away", name: "Away FC", short_name: "AWY" },
    },
    ...overrides,
  };
}

function baseData(overrides: Record<string, unknown[]> = {}) {
  return {
    gameweek_contests: [
      { id: "contest-1", gameweek_id: "gw-1", input_version: 1 },
    ],
    gameweeks: [{ id: "gw-1", number: 1 }],
    member_competitions: [{ user_id: "viewer" }, { user_id: "rival" }],
    gameweek_results: [
      { gameweek_contest_id: "contest-1", outcome: "settled", settled_version: 1 },
    ],
    gameweek_entries: [
      {
        id: "entry-1",
        gameweek_contest_id: "contest-1",
        user_id: "viewer",
        status: "locked_in",
        profiles: { display_name: "Viewer", username: "viewer" },
      },
      {
        id: "entry-2",
        gameweek_contest_id: "contest-1",
        user_id: "rival",
        status: "locked_in",
        profiles: { display_name: "Rival", username: "rival" },
      },
    ],
    gameweek_fixtures: [fixtureRow()],
    gameweek_picks: [],
    gameweek_entry_results: [],
    ...overrides,
  };
}

function database(
  data: Record<string, unknown[] | ((from: number, to: number) => unknown[])>,
  calls: Call[],
) {
  return {
    from(table: string) {
      const result = () => {
        const value = data[table] ?? [];
        if (typeof value === "function") return value(currentFrom ?? 0, currentTo ?? 0);
        if (currentFrom != null && Array.isArray(value)) return value.slice(currentFrom, (currentTo ?? currentFrom) + 1);
        return value;
      };
      let currentFrom: number | undefined;
      let currentTo: number | undefined;
      const query: any = {
        select: (...args: unknown[]) => {
          calls.push({ table, method: "select", args });
          return query;
        },
        eq: (...args: unknown[]) => {
          calls.push({ table, method: "eq", args });
          return query;
        },
        in: (...args: unknown[]) => {
          calls.push({ table, method: "in", args });
          return query;
        },
        order: (...args: unknown[]) => {
          calls.push({ table, method: "order", args });
          return query;
        },
        range: (from: number, to: number) => {
          currentFrom = from;
          currentTo = to;
          calls.push({ table, method: "range", args: [from, to] });
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          const value = result();
          const response = value && !Array.isArray(value) && "data" in (value as object)
            ? value
            : { data: value, error: null };
          return Promise.resolve(response).then(resolve, reject);
        },
      };
      return query;
    },
  } as never;
}

function load(data: Record<string, unknown[] | ((from: number, to: number) => unknown[])>, adminData: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  return {
    calls,
    run: () => loadSeasonPickCorpus(database(data, calls), database(adminData, calls), leagueId, competitionId, "viewer"),
  };
}

function rangeCalls(calls: Call[], table: string) {
  return calls.filter((call) => call.table === table && call.method === "range").map((call) => call.args[0]);
}

describe("loadSeasonPickCorpus", () => {
  it("pages more than 1,000 picks until the short page and keeps boundary order", async () => {
    const picks = Array.from({ length: 2001 }, (_, index) => ({
      entry_id: index === 1000 ? "entry-999" : `entry-${index}`,
      fixture_id: index === 1000 ? "fixture-2" : "fixture-1",
      pred_home: index,
      pred_away: 0,
    }));
    const entries = picks.map((pick, index) => ({
      id: pick.entry_id,
      gameweek_contest_id: "contest-1",
      user_id: `user-${index}`,
      status: "locked_in",
      profiles: { display_name: `User ${index}`, username: `user-${index}` },
    }));
    const fixtureData = baseData({
      gameweek_entries: entries,
      gameweek_fixtures: [
        fixtureRow(),
        fixtureRow({
          id: "membership-2",
          fixture_id: "fixture-2",
          fixtures: {
            ...fixtureRow().fixtures,
            id: "fixture-2",
          },
        }),
      ],
      gameweek_picks: picks,
    });
    const loaded = load(fixtureData);
    const corpus = await loaded.run();
    expect(rangeCalls(loaded.calls, "gameweek_picks")).toEqual([0, 1000, 2000]);
    expect(corpus.picks).toHaveLength(2001);
    expect(corpus.picks[0]?.userId).toBe("user-0");
    expect(corpus.picks.at(-1)?.userId).toBe("user-2000");
    expect(new Set(corpus.picks.map((pick) => `${pick.userId}:${pick.fixtureId}`)).size).toBe(2001);
  });

  it("labels a paged query error and returns no partial corpus", async () => {
    const data = baseData({
      gameweek_fixtures: { data: [], error: { message: "fixtures failed" } } as never,
    });
    await expect(load(data).run()).rejects.toThrow("analytics-corpus-fixtures: fixtures failed");
  });

  it("uses the named foreign-key embeds for fixtures and stored entry results", async () => {
    const loaded = load(baseData());
    await loaded.run();
    const fixtureSelect = loaded.calls.find((call) => call.table === "gameweek_fixtures" && call.method === "select");
    const resultSelect = loaded.calls.find((call) => call.table === "gameweek_entry_results" && call.method === "select");
    expect(String(fixtureSelect?.args[0])).toContain("gameweek_fixtures_fixture_id_competition_id_fkey");
    expect(String(fixtureSelect?.args[0])).toContain("fixtures_home_team_id_fkey");
    expect(String(resultSelect?.args[0])).toContain("gameweek_entry_results_entry_id_fkey");
  });

  it("filters entries at the read boundary to locked_in and excludes entered/invalid entrants", async () => {
    const loaded = load(baseData({
      gameweek_entries: [
        {
          id: "entry-locked",
          gameweek_contest_id: "contest-1",
          user_id: "locked-user",
          status: "locked_in",
          profiles: { display_name: "Locked", username: "locked" },
        },
        {
          id: "entry-entered",
          gameweek_contest_id: "contest-1",
          user_id: "entered-user",
          status: "entered",
          profiles: { display_name: "Entered", username: "entered" },
        },
        {
          id: "entry-invalid",
          gameweek_contest_id: "contest-1",
          user_id: "invalid-user",
          status: "invalid",
          profiles: { display_name: "Invalid", username: "invalid" },
        },
      ],
      gameweek_picks: [
        { entry_id: "entry-locked", fixture_id: "fixture-1", pred_home: 2, pred_away: 1 },
        { entry_id: "entry-entered", fixture_id: "fixture-1", pred_home: 1, pred_away: 0 },
        { entry_id: "entry-invalid", fixture_id: "fixture-1", pred_home: 0, pred_away: 0 },
      ],
    }));
    const corpus = await loaded.run();
    expect(loaded.calls).toContainEqual({ table: "gameweek_entries", method: "eq", args: ["status", "locked_in"] });
    expect(corpus.picks.map((pick) => pick.userId)).toEqual(["locked-user"]);
    expect(corpus.gameweeks[0]?.entrantIds).toEqual(["locked-user"]);
  });

  it("collapses fixture membership history before projecting fixtures", async () => {
    const loaded = load(baseData({
      gameweek_fixtures: [
        fixtureRow({ id: "void-membership", state: "void", void_reason: "replaced" }),
        fixtureRow({ id: "active-membership", state: "active" }),
        fixtureRow({ id: "excluded-membership", fixture_id: "fixture-excluded", state: "excluded" }),
      ],
    }));
    const corpus = await loaded.run();
    expect(corpus.fixtures).toHaveLength(1);
    expect(corpus.fixtures[0]?.state).toBe("final");
    expect(corpus.fixtures[0]?.fixtureId).toBe("fixture-1");
  });

  it("suppresses a dirty gameweek and records recalculating", async () => {
    const corpus = await load(baseData({
      gameweek_contests: [{ id: "contest-1", gameweek_id: "gw-1", input_version: 2 }],
      gameweek_results: [{ gameweek_contest_id: "contest-1", outcome: "settled", settled_version: 1 }],
    })).run();
    expect(corpus.gameweeks).toEqual([]);
    expect(corpus.excludedGameweeks).toEqual([{ gwNumber: 1, reason: "recalculating" }]);
    expect(corpus.fixtures).toEqual([]);
  });

  it("records a fully void gameweek without exposing its fixtures or picks", async () => {
    const corpus = await load(baseData({
      gameweek_results: [{ gameweek_contest_id: "contest-1", outcome: "void", settled_version: 1, void_reason: "all_fixtures_void" }],
    })).run();
    expect(corpus.gameweeks).toEqual([]);
    expect(corpus.excludedGameweeks).toEqual([{ gwNumber: 1, reason: "void" }]);
    expect(corpus.fixtures).toEqual([]);
  });

  it("resolves a departed entrant name through the admin profile read", async () => {
    const corpus = await load(
      baseData({
        member_competitions: [{ user_id: "viewer" }],
        gameweek_entries: [{
          id: "entry-2",
          gameweek_contest_id: "contest-1",
          user_id: "departed",
          status: "locked_in",
          profiles: null,
        }],
      }),
      { profiles: [{ id: "departed", display_name: "Former Player", username: "former" }] },
    ).run();
    expect(corpus.members).toContainEqual({ userId: "departed", name: "Former Player", isViewer: false });
  });

  it("keeps every scope query competition-bound", async () => {
    const loaded = load(baseData());
    await loaded.run();
    for (const table of ["gameweek_contests", "gameweeks", "member_competitions", "gameweek_fixtures"]) {
      expect(loaded.calls).toContainEqual({ table, method: "eq", args: ["competition_id", competitionId] });
    }
    expect(loaded.calls).not.toContainEqual({ table: "gameweek_contests", method: "eq", args: ["competition_id", "other-competition"] });
  });
});
