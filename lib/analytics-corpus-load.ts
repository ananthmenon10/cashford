import type { SupabaseClient } from "@supabase/supabase-js";
import { collapseGameweekFixtures } from "./gw-fixtures";
import { isGameweekResultDirty } from "./net-balance";

type CashfordClient = SupabaseClient<any, "cashford", any>;

export type CorpusPick = {
  userId: string;
  gwNumber: number;
  fixtureId: string;
  predHome: number;
  predAway: number;
};

export type CorpusFixture = {
  fixtureId: string;
  gwNumber: number;
  state: "final" | "void";
  ftHome: number | null;
  ftAway: number | null;
  homeTeamId: string;
  awayTeamId: string;
  homeName: string;
  homeShort: string;
  awayName: string;
  awayShort: string;
};

export type CorpusEntryResult = {
  userId: string;
  gwNumber: number;
  points: number;
  exacts: number;
  goalError: number;
  perFixture: {
    fixtureId: string;
    verdict: "exact" | "result" | "miss" | "void";
    pts: 0 | 1 | 3;
  }[];
};

export type SeasonPickCorpus = {
  leagueId: string;
  competitionId: string;
  members: { userId: string; name: string; isViewer: boolean }[];
  gameweeks: { gwNumber: number; entrantIds: string[] }[];
  excludedGameweeks: {
    gwNumber: number;
    reason: "void" | "recalculating" | "not_settled";
  }[];
  fixtures: CorpusFixture[];
  picks: CorpusPick[];
  results: CorpusEntryResult[];
};

export const CORPUS_FIXTURES_SELECT =
  "id, gameweek_id, fixture_id, state, void_reason, fixtures!gameweek_fixtures_fixture_id_competition_id_fkey(id, competition_id, ft_home, ft_away, home_team_id, away_team_id, home_label, away_label, home_team:teams!fixtures_home_team_id_fkey(id, name, short_name), away_team:teams!fixtures_away_team_id_fkey(id, name, short_name))";

export const CORPUS_PICKS_SELECT = "entry_id, fixture_id, pred_home, pred_away";

export const CORPUS_RESULTS_SELECT =
  "entry_id, gameweek_contest_id, points, exacts, goal_error, per_fixture, gameweek_entries!gameweek_entry_results_entry_id_fkey!inner(user_id, gameweek_contest_id)";

const PAGE_SIZE = 1000;
const VERDICTS = new Set(["exact", "result", "miss", "void"]);

function fail(error: { message?: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error?.message ?? "query-failed"}`);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function readPages<T>(
  makeQuery: () => any,
  context: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const query = await makeQuery().range(from, from + PAGE_SIZE - 1);
    fail(query.error, context);
    const page = (query.data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function profileName(profile: any): string | null {
  const value = one<any>(profile);
  return value?.display_name ?? value?.username ?? null;
}

function parsedPerFixture(value: unknown): CorpusEntryResult["perFixture"] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows: CorpusEntryResult["perFixture"] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as any).fixtureId !== "string" ||
      !VERDICTS.has((item as any).verdict) ||
      ![0, 1, 3].includes((item as any).pts)
    ) {
      return null;
    }
    rows.push({
      fixtureId: (item as any).fixtureId,
      verdict: (item as any).verdict,
      pts: (item as any).pts,
    });
  }
  return rows;
}

function emptyCorpus(
  leagueId: string,
  competitionId: string,
): SeasonPickCorpus {
  return {
    leagueId,
    competitionId,
    members: [],
    gameweeks: [],
    excludedGameweeks: [],
    fixtures: [],
    picks: [],
    results: [],
  };
}

/**
 * Read the settled gameweek prediction corpus for one league/competition pair.
 *
 * This loader never grades a pick. The per-fixture verdict and points values are the settlement
 * snapshot written by the gameweek engine. The three unbounded reads are paged because a league
 * can cross PostgREST's default response cap.
 */
export async function loadSeasonPickCorpus(
  supabase: CashfordClient,
  admin: CashfordClient,
  leagueId: string,
  competitionId: string,
  viewerId: string,
): Promise<SeasonPickCorpus> {
  const [contestsQuery, gameweeksQuery, membersQuery] = await Promise.all([
    supabase
      .from("gameweek_contests")
      .select("id, gameweek_id, input_version")
      .eq("league_id", leagueId)
      .eq("competition_id", competitionId),
    supabase
      .from("gameweeks")
      .select("id, number")
      .eq("competition_id", competitionId)
      .order("number", { ascending: true }),
    supabase
      .from("member_competitions")
      .select("user_id")
      .eq("league_id", leagueId)
      .eq("competition_id", competitionId),
  ]);
  fail(contestsQuery.error, "analytics-corpus-contests");
  fail(gameweeksQuery.error, "analytics-corpus-gameweeks");
  fail(membersQuery.error, "analytics-corpus-members");

  const contests = (contestsQuery.data ?? []) as any[];
  const gameweeks = (gameweeksQuery.data ?? []) as any[];
  const contestIds = contests.map((contest) => contest.id).filter(Boolean);
  if (contestIds.length === 0) return emptyCorpus(leagueId, competitionId);

  const [resultsQuery, entriesQuery] = await Promise.all([
    supabase
      .from("gameweek_results")
      .select("gameweek_contest_id, outcome, settled_version, void_reason")
      .in("gameweek_contest_id", contestIds),
    supabase
      .from("gameweek_entries")
      .select(
        "id, gameweek_contest_id, user_id, status, profiles(display_name, username)",
      )
      .in("gameweek_contest_id", contestIds)
      .eq("status", "locked_in"),
  ]);
  fail(resultsQuery.error, "analytics-corpus-gameweek-results");
  fail(entriesQuery.error, "analytics-corpus-entries");

  const gameweekById = new Map<string, any>(
    gameweeks.map((gameweek) => [gameweek.id, gameweek]),
  );
  const contestById = new Map<string, any>(
    contests.map((contest) => [contest.id, contest]),
  );
  const resultByContest = new Map<string, any>(
    (resultsQuery.data ?? []).map((result: any) => [
      result.gameweek_contest_id,
      result,
    ]),
  );
  const excludedGameweeks: SeasonPickCorpus["excludedGameweeks"] = [];
  const includedGameweeks: { id: string; gwNumber: number; contestId: string }[] = [];
  for (const contest of contests) {
    const gameweek = gameweekById.get(contest.gameweek_id);
    if (!gameweek) continue;
    const result = resultByContest.get(contest.id);
    if (!result) {
      excludedGameweeks.push({ gwNumber: gameweek.number, reason: "not_settled" });
    } else if (result.outcome === "void") {
      excludedGameweeks.push({ gwNumber: gameweek.number, reason: "void" });
    } else if (
      isGameweekResultDirty({
        inputVersion: contest.input_version,
        settledVersion: result.settled_version,
      })
    ) {
      excludedGameweeks.push({
        gwNumber: gameweek.number,
        reason: "recalculating",
      });
    } else if (result.outcome === "settled") {
      includedGameweeks.push({
        id: gameweek.id,
        gwNumber: gameweek.number,
        contestId: contest.id,
      });
    } else {
      excludedGameweeks.push({ gwNumber: gameweek.number, reason: "not_settled" });
    }
  }
  includedGameweeks.sort((a, b) => a.gwNumber - b.gwNumber);
  excludedGameweeks.sort((a, b) => a.gwNumber - b.gwNumber);

  const entries = ((entriesQuery.data ?? []) as any[]).filter(
    (entry) => entry.status === "locked_in",
  );
  const includedContestIds = new Set(includedGameweeks.map((row) => row.contestId));
  const entryMeta = new Map<
    string,
    { userId: string; gwNumber: number; contestId: string; status: string }
  >();
  const names = new Map<string, string>();
  for (const entry of entries) {
    const contest = contestById.get(entry.gameweek_contest_id);
    const gameweek = contest ? gameweekById.get(contest.gameweek_id) : null;
    if (!contest || !gameweek) continue;
    const name = profileName(entry.profiles);
    if (name) names.set(entry.user_id, name);
    if (includedContestIds.has(contest.id)) {
      entryMeta.set(entry.id, {
        userId: entry.user_id,
        gwNumber: gameweek.number,
        contestId: contest.id,
        status: entry.status,
      });
    }
  }

  const memberIds = new Set<string>([
    viewerId,
    ...(membersQuery.data ?? []).map((member: any) => member.user_id),
    ...entries.map((entry: any) => entry.user_id),
  ]);
  const missingIds = [...memberIds].filter((userId) => !names.has(userId));
  if (missingIds.length) {
    const profilesQuery = await admin
      .from("profiles")
      .select("id, display_name, username")
      .in("id", missingIds);
    fail(profilesQuery.error, "analytics-corpus-departed-names");
    for (const profile of profilesQuery.data ?? []) {
      const name = profileName(profile);
      if (name) names.set(profile.id, name);
    }
  }

  const lockedEntryIds = [...entryMeta.entries()]
    .filter(([, entry]) => entry.status === "locked_in")
    .map(([entryId]) => entryId);
  const includedGameweekIds = includedGameweeks.map((gameweek) => gameweek.id);
  const fixtureRows = includedGameweekIds.length
    ? await readPages<any>(
        () =>
          supabase
            .from("gameweek_fixtures")
            .select(CORPUS_FIXTURES_SELECT)
            .eq("competition_id", competitionId)
            .in("gameweek_id", includedGameweekIds)
            .order("gameweek_id", { ascending: true })
            .order("fixture_id", { ascending: true })
            .order("id", { ascending: true }),
        "analytics-corpus-fixtures",
      )
    : [];
  const pickRows = lockedEntryIds.length
    ? await readPages<any>(
        () =>
          supabase
            .from("gameweek_picks")
            .select(CORPUS_PICKS_SELECT)
            .in("entry_id", lockedEntryIds)
            .order("entry_id", { ascending: true })
            .order("fixture_id", { ascending: true })
            .order("id", { ascending: true }),
        "analytics-corpus-picks",
      )
    : [];
  const resultRows = lockedEntryIds.length
    ? await readPages<any>(
        () =>
          supabase
            .from("gameweek_entry_results")
            .select(CORPUS_RESULTS_SELECT)
            .in("entry_id", lockedEntryIds)
            .order("entry_id", { ascending: true })
            .order("gameweek_contest_id", { ascending: true }),
        "analytics-corpus-entry-results",
      )
    : [];

  const fixtures: CorpusFixture[] = [];
  const rawByGameweek = new Map<string, any[]>();
  for (const row of fixtureRows) {
    const list = rawByGameweek.get(row.gameweek_id) ?? [];
    list.push({
      fixtureId: row.fixture_id,
      membershipId: row.id,
      state: row.state,
      voidReason: row.void_reason,
      fixture: one<any>(row.fixtures),
    });
    rawByGameweek.set(row.gameweek_id, list);
  }
  for (const gameweek of includedGameweeks) {
    const collapsed = collapseGameweekFixtures(rawByGameweek.get(gameweek.id) ?? []);
    for (const row of collapsed) {
      const fixture = row.fixture as any;
      const home = one<any>(fixture?.home_team);
      const away = one<any>(fixture?.away_team);
      if (
        !fixture?.id ||
        !fixture.home_team_id ||
        !fixture.away_team_id ||
        !home?.name ||
        !away?.name
      ) {
        continue;
      }
      const mapped: CorpusFixture = {
        fixtureId: fixture.id,
        gwNumber: gameweek.gwNumber,
        state: row.state === "active" ? "final" : "void",
        ftHome: fixture.ft_home ?? null,
        ftAway: fixture.ft_away ?? null,
        homeTeamId: fixture.home_team_id,
        awayTeamId: fixture.away_team_id,
        homeName: home.name,
        homeShort: home.short_name ?? home.name,
        awayName: away.name,
        awayShort: away.short_name ?? away.name,
      };
      fixtures.push(mapped);
    }
  }

  const includedFixtureKeys = new Set(
    fixtures.map((fixture) => `${fixture.gwNumber}:${fixture.fixtureId}`),
  );
  const picks: CorpusPick[] = [];
  for (const row of pickRows) {
    const entry = entryMeta.get(row.entry_id);
    if (
      !entry ||
      !includedFixtureKeys.has(`${entry.gwNumber}:${row.fixture_id}`) ||
      !Number.isInteger(row.pred_home) ||
      !Number.isInteger(row.pred_away)
    ) {
      continue;
    }
    picks.push({
      userId: entry.userId,
      gwNumber: entry.gwNumber,
      fixtureId: row.fixture_id,
      predHome: row.pred_home,
      predAway: row.pred_away,
    });
  }

  const results: CorpusEntryResult[] = [];
  for (const row of resultRows) {
    const entry = entryMeta.get(row.entry_id);
    const perFixture = parsedPerFixture(row.per_fixture);
    if (
      !entry ||
      !includedContestIds.has(entry.contestId) ||
      perFixture == null ||
      !Number.isFinite(row.points) ||
      !Number.isFinite(row.exacts) ||
      !Number.isFinite(row.goal_error)
    ) {
      continue;
    }
    results.push({
      userId: entry.userId,
      gwNumber: entry.gwNumber,
      points: row.points,
      exacts: row.exacts,
      goalError: row.goal_error,
      perFixture,
    });
  }

  const entrantsByGw = new Map<number, Set<string>>();
  for (const entry of entryMeta.values()) {
    if (entry.status !== "locked_in") continue;
    const entrants = entrantsByGw.get(entry.gwNumber) ?? new Set<string>();
    entrants.add(entry.userId);
    entrantsByGw.set(entry.gwNumber, entrants);
  }
  const corpusGameweeks = includedGameweeks.map((gameweek) => ({
    gwNumber: gameweek.gwNumber,
    entrantIds: [...(entrantsByGw.get(gameweek.gwNumber) ?? [])].sort(),
  }));
  const membersOutput = [...memberIds]
    .map((userId) => ({
      userId,
      name: names.get(userId) ?? "Player",
      isViewer: userId === viewerId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));

  return {
    leagueId,
    competitionId,
    members: membersOutput,
    gameweeks: corpusGameweeks,
    excludedGameweeks,
    fixtures: fixtures.sort((a, b) => a.gwNumber - b.gwNumber || a.fixtureId.localeCompare(b.fixtureId)),
    picks,
    results: results.sort((a, b) => a.gwNumber - b.gwNumber || a.userId.localeCompare(b.userId)),
  };
}

export const loadAnalyticsCorpus = loadSeasonPickCorpus;
