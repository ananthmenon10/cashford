import type { SupabaseClient } from "@supabase/supabase-js";
import { isGameweekResultDirty, netBalance } from "./net-balance";
import {
  loadGameweekView,
  type LeagueIdentity,
} from "./gw-view";

export type SeasonInputRow = {
  gwNumber: number;
  gameweekName?: string;
  status: string;
  entryStatus: string | null;
  points: number | null;
  exacts: number | null;
  countedFixtures: number | null;
  correctPicks: number | null;
  incorrectPicks: number | null;
  voidPicks: number | null;
  netInr: number;
  inputVersion: number;
  settledVersion: number | null;
  isVoid: boolean;
  outcome?: "settled" | "void" | null;
  voidReason?: "no_entrants" | "single_entrant" | "all_fixtures_void" | null;
  deadlineAt?: string | null;
  winnerName?: string | null;
  rank?: number | null;
  hasContest?: boolean;
  [key: string]: unknown;
};

export type SeasonRow = SeasonInputRow & {
  viewerId: string;
  href: string;
  dirty: boolean;
  displayNetInr: number | "suppressed";
};

type PerFixtureSnapshot = { verdict?: string };

type SnapshotStats = Pick<
  SeasonInputRow,
  "countedFixtures" | "correctPicks" | "incorrectPicks" | "voidPicks"
>;

export function snapshotStats(
  snapshot: any,
  outcome: SeasonInputRow["outcome"],
  dirty: boolean,
): SnapshotStats | null {
  if (
    outcome !== "settled" ||
    dirty ||
    !snapshot ||
    !Array.isArray(snapshot.per_fixture)
  ) {
    return null;
  }
  const perFixture = snapshot.per_fixture as PerFixtureSnapshot[];
  const knownVerdicts = new Set(["exact", "result", "miss", "void"]);
  if (perFixture.some((fixture) => !knownVerdicts.has(fixture.verdict as string))) {
    return null;
  }
  return {
    countedFixtures: perFixture.filter((fixture) => fixture.verdict !== "void").length,
    correctPicks: perFixture.filter(
      (fixture) => fixture.verdict === "exact" || fixture.verdict === "result",
    ).length,
    incorrectPicks: perFixture.filter((fixture) => fixture.verdict === "miss").length,
    voidPicks: perFixture.filter((fixture) => fixture.verdict === "void").length,
  };
}

function rowIsDirty(row: SeasonInputRow): boolean {
  return (
    row.settledVersion != null &&
    isGameweekResultDirty({
      inputVersion: row.inputVersion,
      settledVersion: row.settledVersion,
    })
  );
}

export function buildSeasonRows(
  gameweeks: readonly SeasonInputRow[],
  viewerId: string,
): SeasonRow[] {
  return gameweeks.map((row) => {
    const dirty = rowIsDirty(row);
    return {
      ...row,
      viewerId,
      href: `?gw=${row.gwNumber}`,
      dirty,
      displayNetInr: dirty ? "suppressed" : row.netInr,
    };
  });
}

export function buildRunningTotals(rows: readonly SeasonInputRow[]): {
  points: number | "suppressed";
  exacts: number;
  gameweeksEntered: number;
  netInr: number | "suppressed";
} {
  const pointsSuppressed = rows.some(
    (row) => rowIsDirty(row) && row.points == null,
  );
  const balances = rows.map((row) =>
    row.settledVersion == null
      ? row.netInr
      : netBalance({
          ledger: "pl",
          inputVersion: row.inputVersion,
          settledVersion: row.settledVersion,
          amountInr: row.netInr,
        }),
  );
  return {
    points: pointsSuppressed
      ? "suppressed"
      : rows.reduce((sum, row) => sum + (row.points ?? 0), 0),
    exacts: rows.reduce((sum, row) => sum + (row.exacts ?? 0), 0),
    gameweeksEntered: rows.filter((row) => row.entryStatus === "locked_in").length,
    netInr: balances.some((balance) => balance === "suppressed")
      ? "suppressed"
      : balances.reduce<number>((sum, balance) => sum + Number(balance), 0),
  };
}

type CashfordClient = SupabaseClient<any, "cashford", any>;

export type SeasonMemberTotal = {
  userId: string;
  name: string;
  points: number | "suppressed";
  exacts: number;
  gameweeksEntered: number;
  netInr: number | "suppressed";
  isViewer: boolean;
  hasEntries: boolean;
};

export type SeasonView = {
  rows: SeasonRow[];
  totals: SeasonMemberTotal[];
  viewerName: string | null;
};

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function loadSeasonView(
  supabase: CashfordClient,
  admin: CashfordClient,
  identity: LeagueIdentity,
  viewerId: string,
): Promise<SeasonView> {
  if (
    identity.participation.status === "none" ||
    identity.participation.format !== "gameweek" ||
    !identity.participation.competitionId
  ) {
    return { rows: [], totals: [], viewerName: null };
  }
  const competitionId = identity.participation.competitionId;
  const [contestsQuery, gameweeksQuery, membersQuery] = await Promise.all([
    supabase
      .from("gameweek_contests")
      .select("id, gameweek_id, input_version, status, deadline_at")
      .eq("league_id", identity.league.id)
      .eq("competition_id", competitionId),
    supabase
      .from("gameweeks")
      .select("id, number, name, status, deadline_at")
      .eq("competition_id", competitionId)
      .order("number", { ascending: true }),
    supabase
      .from("member_competitions")
      .select("user_id")
      .eq("league_id", identity.league.id)
      .eq("competition_id", competitionId),
  ]);
  fail(contestsQuery.error, "season-contests");
  fail(gameweeksQuery.error, "season-gameweeks");
  fail(membersQuery.error, "season-members");
  const contests = (contestsQuery.data ?? []) as any[];
  const gameweeks = (gameweeksQuery.data ?? []) as any[];
  const contestIds = contests.map((contest) => contest.id);
  if (!contestIds.length) return { rows: [], totals: [], viewerName: null };

  const [resultsQuery, entriesQuery, entryResultsQuery] = await Promise.all([
    supabase
      .from("gameweek_results")
      .select(
        "gameweek_contest_id, outcome, settled_version, void_reason",
      )
      .in("gameweek_contest_id", contestIds),
    supabase
      .from("gameweek_entries")
      .select("id, gameweek_contest_id, user_id, status, profiles(display_name, username)")
      .in("gameweek_contest_id", contestIds),
    supabase
      .from("gameweek_entry_results")
      .select("entry_id, gameweek_contest_id, points, exacts, net_inr, is_winner, goal_error, per_fixture")
      .in("gameweek_contest_id", contestIds),
  ]);
  fail(resultsQuery.error, "season-results");
  fail(entriesQuery.error, "season-entries");
  fail(entryResultsQuery.error, "season-entry-results");

  const results = new Map(
    (resultsQuery.data ?? []).map((result: any) => [
      result.gameweek_contest_id,
      result,
    ]),
  );
  const entries = (entriesQuery.data ?? []) as any[];
  const members = (membersQuery.data ?? []) as any[];
  const entryResults = new Map(
    (entryResultsQuery.data ?? []).map((result: any) => [result.entry_id, result]),
  );
  const gameweekById = new Map(gameweeks.map((gameweek) => [gameweek.id, gameweek]));
  const contestById = new Map(contests.map((contest) => [contest.id, contest]));
  const leagueGameweeks = gameweeks.filter((gameweek) =>
    contests.some((contest) => contest.gameweek_id === gameweek.id),
  );
  const names = new Map<string, string>();
  for (const entry of entries) {
    const profile = one<any>(entry.profiles);
    if (profile) names.set(entry.user_id, profile.display_name ?? profile.username);
  }
  const memberIds = new Set<string>([
    viewerId,
    ...members.map((member) => member.user_id),
    ...entries.map((entry) => entry.user_id),
  ]);
  const missingIds = [...memberIds].filter(
    (userId) => !names.has(userId),
  );
  if (missingIds.length) {
    const departedQuery = await admin
      .from("profiles")
      .select("id, display_name, username")
      .in("id", missingIds);
    fail(departedQuery.error, "season-departed-names");
    for (const profile of departedQuery.data ?? []) {
      names.set(profile.id, profile.display_name ?? profile.username);
    }
  }
  const viewerName = names.get(viewerId) ?? null;

  const dirtyViews = new Map<number, Awaited<ReturnType<typeof loadGameweekView>>>();
  for (const contest of contests) {
    const result = results.get(contest.id);
    if (
      !result ||
      !isGameweekResultDirty({
        inputVersion: contest.input_version,
        settledVersion: result.settled_version,
      })
    ) {
      continue;
    }
    const gameweek = gameweekById.get(contest.gameweek_id);
    if (!gameweek) continue;
    dirtyViews.set(
      gameweek.number,
      await loadGameweekView(
        supabase,
        admin,
        identity,
        viewerId,
        gameweek.number,
        new Date(),
        false,
      ),
    );
  }

  const byUser = new Map<string, SeasonInputRow[]>();
  const entriesByContest = new Map<string, any[]>();
  for (const entry of entries) {
    const list = entriesByContest.get(entry.gameweek_contest_id) ?? [];
    list.push(entry);
    entriesByContest.set(entry.gameweek_contest_id, list);
  }

  const rankByEntryId = new Map<string, number>();
  const winnerByContestId = new Map<string, string>();
  for (const contest of contests) {
    const gameweek = gameweekById.get(contest.gameweek_id);
    if (!gameweek) continue;
    const result = results.get(contest.id);
    const dirty = !!result && isGameweekResultDirty({
      inputVersion: contest.input_version,
      settledVersion: result.settled_version,
    });
    const liveStandings = dirtyViews.get(gameweek.number)?.standings ?? [];
    const ranked = (entriesByContest.get(contest.id) ?? [])
      .map((entry) => {
        const snapshot = entryResults.get(entry.id);
        const live = liveStandings.find((standing) => standing.userId === entry.user_id);
        return {
          entry,
          points: dirty ? live?.points ?? null : snapshot?.points ?? 0,
          exacts: dirty ? live?.exacts ?? null : snapshot?.exacts ?? 0,
          goalError: dirty ? live?.goalError ?? null : snapshot?.goal_error ?? 0,
        };
      })
      .sort(
        (a, b) =>
          (b.points ?? -1) - (a.points ?? -1) ||
          (b.exacts ?? -1) - (a.exacts ?? -1) ||
          (a.goalError ?? Number.MAX_SAFE_INTEGER) -
            (b.goalError ?? Number.MAX_SAFE_INTEGER),
      );
    ranked.forEach((item, index) => rankByEntryId.set(item.entry.id, index + 1));
    const liveWinner = liveStandings.find((standing) => standing.rank === 1);
    const winnerEntry = (entriesByContest.get(contest.id) ?? []).find(
      (entry) => entryResults.get(entry.id)?.is_winner === true,
    );
    if (liveWinner) {
      winnerByContestId.set(contest.id, liveWinner.name);
    } else if (winnerEntry) {
      winnerByContestId.set(
        contest.id,
        names.get(winnerEntry.user_id) ?? "Player",
      );
    }
  }

  const rowsByGameweek = new Map<number, SeasonInputRow>();
  for (const gameweek of leagueGameweeks) {
    const contest = contests.find((candidate) => candidate.gameweek_id === gameweek.id);
    const result = contest ? results.get(contest.id) : null;
    const entry = contest
      ? (entriesByContest.get(contest.id) ?? []).find(
          (candidate) => candidate.user_id === viewerId,
        )
      : null;
    const dirty = !!contest && !!result && isGameweekResultDirty({
      inputVersion: contest.input_version,
      settledVersion: result.settled_version,
    });
    const snapshot = entry ? entryResults.get(entry.id) : null;
    const liveStanding = entry
      ? dirtyViews.get(gameweek.number)?.standings.find(
          (standing) => standing.userId === viewerId,
        )
      : null;
    const stats = snapshotStats(snapshot, result?.outcome ?? null, dirty);
    rowsByGameweek.set(gameweek.number, {
      gwNumber: gameweek.number,
      gameweekName: gameweek.name,
      status: contest?.status ?? gameweek.status,
      entryStatus: entry?.status ?? null,
      points: entry
        ? dirty
          ? liveStanding?.points ?? null
          : snapshot?.points ?? 0
        : null,
      exacts: entry
        ? dirty
          ? liveStanding?.exacts ?? null
          : snapshot?.exacts ?? 0
        : null,
      countedFixtures: stats?.countedFixtures ?? null,
      correctPicks: stats?.correctPicks ?? null,
      incorrectPicks: stats?.incorrectPicks ?? null,
      voidPicks: stats?.voidPicks ?? null,
      netInr: snapshot?.net_inr ?? 0,
      inputVersion: contest?.input_version ?? 0,
      settledVersion: result?.settled_version ?? null,
      isVoid: result?.outcome === "void",
      outcome: result?.outcome ?? null,
      voidReason: result?.void_reason ?? null,
      deadlineAt: contest?.deadline_at ?? gameweek.deadline_at ?? null,
      winnerName: contest ? winnerByContestId.get(contest.id) ?? null : null,
      rank: entry ? rankByEntryId.get(entry.id) ?? null : null,
      hasContest: !!contest,
    });
  }

  for (const entry of entries) {
    const contest = contestById.get(entry.gameweek_contest_id);
    const gameweek = contest ? gameweekById.get(contest.gameweek_id) : null;
    if (!contest || !gameweek) continue;
    const result = results.get(contest.id);
    const dirty = !!result && isGameweekResultDirty({
      inputVersion: contest.input_version,
      settledVersion: result.settled_version,
    });
    const snapshot = entryResults.get(entry.id);
    const liveStanding = dirtyViews
      .get(gameweek.number)
      ?.standings.find((standing) => standing.userId === entry.user_id);
    const stats = snapshotStats(snapshot, result?.outcome ?? null, dirty);
    const row: SeasonInputRow = {
      gwNumber: gameweek.number,
      gameweekName: gameweek.name,
      status: contest.status,
      entryStatus: entry.status,
      points: dirty ? liveStanding?.points ?? null : snapshot?.points ?? 0,
      exacts: dirty ? liveStanding?.exacts ?? null : snapshot?.exacts ?? 0,
      countedFixtures: stats?.countedFixtures ?? null,
      correctPicks: stats?.correctPicks ?? null,
      incorrectPicks: stats?.incorrectPicks ?? null,
      voidPicks: stats?.voidPicks ?? null,
      netInr: snapshot?.net_inr ?? 0,
      inputVersion: contest.input_version,
      settledVersion: result?.settled_version ?? null,
      isVoid: result?.outcome === "void",
      outcome: result?.outcome ?? null,
      voidReason: result?.void_reason ?? null,
      deadlineAt: contest.deadline_at ?? gameweek.deadline_at ?? null,
      winnerName: winnerByContestId.get(contest.id) ?? null,
      rank: rankByEntryId.get(entry.id) ?? null,
      hasContest: true,
    };
    const current = byUser.get(entry.user_id) ?? [];
    current.push(row);
    byUser.set(entry.user_id, current);
  }

  const viewerRows = buildSeasonRows(
    [...rowsByGameweek.values()].sort((a, b) => b.gwNumber - a.gwNumber),
    viewerId,
  );
  const totals = [...memberIds]
    .map((userId) => {
      const rows = byUser.get(userId) ?? [];
      return {
        userId,
        name: names.get(userId) ?? "Player",
        ...buildRunningTotals(rows),
        isViewer: userId === viewerId,
        hasEntries: rows.length > 0,
      };
    })
    .sort((a, b) => {
      if (a.hasEntries !== b.hasEntries) return a.hasEntries ? -1 : 1;
      if (a.points === "suppressed" && b.points !== "suppressed") return 1;
      if (b.points === "suppressed" && a.points !== "suppressed") return -1;
      return Number(b.points) - Number(a.points) || b.exacts - a.exacts || a.name.localeCompare(b.name);
    });

  return { rows: viewerRows, totals, viewerName };
}
