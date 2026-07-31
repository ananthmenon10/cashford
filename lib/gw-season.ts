import type { SupabaseClient } from "@supabase/supabase-js";
import { isGameweekResultDirty, netBalance } from "./net-balance";
import {
  loadGameweekView,
  type LeagueIdentity,
} from "./gw-view";

export type SeasonInputRow = {
  gwNumber: number;
  status: string;
  entryStatus: string | null;
  points: number | null;
  exacts: number | null;
  netInr: number;
  inputVersion: number;
  settledVersion: number | null;
  isVoid: boolean;
  [key: string]: unknown;
};

export type SeasonRow = SeasonInputRow & {
  viewerId: string;
  href: string;
  dirty: boolean;
  displayNetInr: number | "suppressed";
};

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
};

export type SeasonView = {
  rows: SeasonRow[];
  totals: SeasonMemberTotal[];
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
    return { rows: [], totals: [] };
  }
  const competitionId = identity.participation.competitionId;
  const [contestsQuery, gameweeksQuery] = await Promise.all([
    supabase
      .from("gameweek_contests")
      .select("id, gameweek_id, input_version, status")
      .eq("league_id", identity.league.id)
      .eq("competition_id", competitionId),
    supabase
      .from("gameweeks")
      .select("id, number, name")
      .eq("competition_id", competitionId)
      .order("number", { ascending: true }),
  ]);
  fail(contestsQuery.error, "season-contests");
  fail(gameweeksQuery.error, "season-gameweeks");
  const contests = (contestsQuery.data ?? []) as any[];
  const gameweeks = (gameweeksQuery.data ?? []) as any[];
  const contestIds = contests.map((contest) => contest.id);
  if (!contestIds.length) return { rows: [], totals: [] };

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
      .select("entry_id, gameweek_contest_id, points, exacts, net_inr")
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
  const entryResults = new Map(
    (entryResultsQuery.data ?? []).map((result: any) => [result.entry_id, result]),
  );
  const gameweekById = new Map(gameweeks.map((gameweek) => [gameweek.id, gameweek]));
  const contestById = new Map(contests.map((contest) => [contest.id, contest]));
  const names = new Map<string, string>();
  for (const entry of entries) {
    const profile = one<any>(entry.profiles);
    if (profile) names.set(entry.user_id, profile.display_name ?? profile.username);
  }
  const missingIds = [...new Set(entries.map((entry) => entry.user_id))].filter(
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
  for (const entry of entries) {
    const contest = contestById.get(entry.gameweek_contest_id);
    const gameweek = contest ? gameweekById.get(contest.gameweek_id) : null;
    if (!contest || !gameweek) continue;
    const result = results.get(contest.id);
    const dirty =
      !!result &&
      isGameweekResultDirty({
        inputVersion: contest.input_version,
        settledVersion: result.settled_version,
      });
    const snapshot = entryResults.get(entry.id);
    const liveStanding = dirtyViews
      .get(gameweek.number)
      ?.standings.find((standing) => standing.userId === entry.user_id);
    const row: SeasonInputRow = {
      gwNumber: gameweek.number,
      status: contest.status,
      entryStatus: entry.status,
      points: dirty ? liveStanding?.points ?? null : snapshot?.points ?? 0,
      exacts: dirty ? liveStanding?.exacts ?? null : snapshot?.exacts ?? 0,
      netInr: snapshot?.net_inr ?? 0,
      inputVersion: contest.input_version,
      settledVersion: result?.settled_version ?? null,
      isVoid: result?.outcome === "void",
    };
    const current = byUser.get(entry.user_id) ?? [];
    current.push(row);
    byUser.set(entry.user_id, current);
  }

  const viewerRows = buildSeasonRows(
    (byUser.get(viewerId) ?? []).sort((a, b) => b.gwNumber - a.gwNumber),
    viewerId,
  );
  const totals = [...byUser.entries()]
    .map(([userId, rows]) => ({
      userId,
      name: names.get(userId) ?? "Player",
      ...buildRunningTotals(rows),
      isViewer: userId === viewerId,
    }))
    .sort((a, b) => {
      if (a.points === "suppressed" && b.points !== "suppressed") return 1;
      if (b.points === "suppressed" && a.points !== "suppressed") return -1;
      return Number(b.points) - Number(a.points);
    });

  return { rows: viewerRows, totals };
}
