// Step 8 — server loader for the Analytics feed (structure A / cross-comp B / my-form A).
// Enumerates every (league, competition) pair the viewer's leagues participate in — broader than
// lib/matches-tab-load.ts's resolveViewerCompetitionScopes, which drops archived
// league_competitions rows; cross-comp B needs those too, to render the archive section. Live
// (gameweek-format) nets reuse lib/gw-season.ts's loadSeasonView; archive (cup-format) nets come
// from a new, additive, viewer-scoped query mirroring lib/gw-home.ts's loadArchivedCardFacts
// query shape, filtered to `user_id = viewerId` so it never pulls other members' rows.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSeasonView } from "./gw-season";
import { resolveLeagueParticipation, type LeagueParticipationRow } from "./gw-participation";
import type { LeagueIdentity } from "./gw-view";
import type { Entry } from "./analytics";
import {
  buildAnalyticsSections,
  buildAllTimeStrip,
  buildLeagueOptions,
  buildLiveMyForm,
  buildArchiveMyForm,
  type AnalyticsSection,
  type AnalyticsAllTimeStrip,
  type AnalyticsLeagueOption,
  type AnalyticsMyForm,
  type AnalyticsParticipationRow,
} from "./analytics-feed";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export type AnalyticsFeedView = {
  leagueOptions: AnalyticsLeagueOption[];
  sections: AnalyticsSection[];
  myFormByLeague: Record<string, AnalyticsMyForm | null>;
  allTimeStrip: AnalyticsAllTimeStrip | null;
};

const EMPTY_FEED: AnalyticsFeedView = { leagueOptions: [], sections: [], myFormByLeague: {}, allTimeStrip: null };

async function loadArchiveEntries(
  admin: CashfordClient,
  leagueId: string,
  competitionId: string,
  viewerId: string,
): Promise<Entry[]> {
  // predictions and contest_results have no direct FK to each other (both link via contests) —
  // no embed shortcut here; join them in JS by contest id, same as loadArchivedCardFacts in
  // lib/gw-home.ts does for the full-league version of this query.
  const [predictionsQuery, resultsQuery] = await Promise.all([
    admin
      .from("predictions")
      .select(
        "outcome, pred_home, pred_away, contests!inner(id, league_id, fixtures!inner(kickoff_at, home_label, away_label, ft_home, ft_away, is_knockout, advancer_team_id, competition_id))",
      )
      .eq("user_id", viewerId)
      .eq("contests.league_id", leagueId)
      .eq("contests.fixtures.competition_id", competitionId),
    admin
      .from("contest_results")
      .select("net_inr, contests!inner(id, league_id, fixtures!inner(competition_id))")
      .eq("user_id", viewerId)
      .eq("contests.league_id", leagueId)
      .eq("contests.fixtures.competition_id", competitionId),
  ]);
  fail(predictionsQuery.error, "analytics-feed-archive-entries");
  fail(resultsQuery.error, "analytics-feed-archive-results");

  const netByContest = new Map<string, number>();
  for (const row of resultsQuery.data ?? []) {
    const contest = one<any>((row as any).contests);
    if (contest?.id) netByContest.set(contest.id, Number((row as any).net_inr ?? 0));
  }

  const entries: Entry[] = [];
  for (const row of predictionsQuery.data ?? []) {
    const contest = one<any>((row as any).contests);
    const fixture = one<any>(contest?.fixtures);
    if (!fixture || fixture.ft_home == null || fixture.ft_away == null) continue;
    entries.push({
      outcome: (row as any).outcome,
      predHome: (row as any).pred_home,
      predAway: (row as any).pred_away,
      ftHome: fixture.ft_home,
      ftAway: fixture.ft_away,
      isKnockout: fixture.is_knockout,
      advancer: null,
      net: contest?.id ? netByContest.get(contest.id) ?? null : null,
      kickoffMs: new Date(fixture.kickoff_at).getTime(),
      homeLabel: fixture.home_label ?? "Home",
      awayLabel: fixture.away_label ?? "Away",
    });
  }
  return entries;
}

/** Fix-round item 2: null (not a fabricated ₹0) when the viewer has no settled contest_results
 * in this (league, competition) — `settledRounds` is the row count, reused by the all-time strip. */
async function loadArchiveNetAndCount(
  admin: CashfordClient,
  leagueId: string,
  competitionId: string,
  viewerId: string,
): Promise<{ net: number | null; settledRounds: number }> {
  const resultsQuery = await admin
    .from("contest_results")
    .select("net_inr, contests!inner(league_id, fixtures!inner(competition_id))")
    .eq("user_id", viewerId)
    .eq("contests.league_id", leagueId)
    .eq("contests.fixtures.competition_id", competitionId);
  fail(resultsQuery.error, "analytics-feed-archive-net");
  const rows = resultsQuery.data ?? [];
  if (rows.length === 0) return { net: null, settledRounds: 0 };
  return {
    net: rows.reduce((total: number, row: any) => total + Number(row.net_inr ?? 0), 0),
    settledRounds: rows.length,
  };
}

export async function loadAnalyticsFeed(
  supabase: CashfordClient,
  admin: CashfordClient,
  leagues: readonly { id: string; name: string; slug: string }[],
  viewerId: string,
): Promise<AnalyticsFeedView> {
  if (leagues.length === 0) return EMPTY_FEED;
  const leagueIds = leagues.map((l) => l.id);
  const leagueById = new Map(leagues.map((l) => [l.id, l] as const));

  const linksQuery = await supabase
    .from("league_competitions")
    .select("league_id, competition_id, status, joined_at, eligible_from_gameweek_id, competitions!inner(id, name, slug, format, status)")
    .in("league_id", leagueIds);
  fail(linksQuery.error, "analytics-feed-links");

  const rowsByLeague = new Map<string, LeagueParticipationRow[]>();
  const distinctPairs = new Map<
    string,
    { leagueId: string; competitionId: string; competitionName: string; format: "gameweek" | "cup" }
  >();
  for (const row of linksQuery.data ?? []) {
    const competition = one<any>((row as any).competitions);
    if (!competition || (competition.format !== "league" && competition.format !== "cup")) continue;
    const participationRow: LeagueParticipationRow = {
      competition_id: row.competition_id,
      status: row.status,
      joined_at: row.joined_at,
      eligible_from_gameweek_id: row.eligible_from_gameweek_id,
      competitions: competition,
    };
    const forLeague = rowsByLeague.get(row.league_id) ?? [];
    forLeague.push(participationRow);
    rowsByLeague.set(row.league_id, forLeague);
    distinctPairs.set(`${row.league_id}:${row.competition_id}`, {
      leagueId: row.league_id,
      competitionId: row.competition_id,
      competitionName: competition.name,
      format: competition.format === "cup" ? "cup" : "gameweek",
    });
  }

  // Hoist: one loadSeasonView per distinct (league, gameweek-competition) pair, run in parallel —
  // never re-queried per section/my-form consumer.
  const pairs = [...distinctPairs.values()];
  const netByPair = new Map<string, number | "suppressed" | null>();
  const settledRoundsByPair = new Map<string, number>();
  const throughGwByPair = new Map<string, number | null>();
  // Cached so the my-form loop below (which resolves to the SAME pair for gameweek leagues) never
  // re-runs loadSeasonView for a league+competition already fetched here — the N+1 the brief flags.
  const seasonViewByPair = new Map<string, Awaited<ReturnType<typeof loadSeasonView>>>();
  await Promise.all(
    pairs.map(async (pair) => {
      const league = leagueById.get(pair.leagueId);
      if (!league) return;
      const key = `${pair.leagueId}:${pair.competitionId}`;
      if (pair.format === "gameweek") {
        const identity: LeagueIdentity = {
          league: { id: league.id, name: league.name, slug: league.slug, createdBy: "", status: "active" },
          participation: {
            status: "active",
            format: "gameweek",
            competitionId: pair.competitionId,
            competitionName: pair.competitionName,
            competitionSlug: pair.competitionId,
          },
        };
        const season = await loadSeasonView(supabase, admin, identity, viewerId);
        seasonViewByPair.set(key, season);
        const viewerTotal = season.totals.find((t) => t.isViewer);
        // Fix-round item 2: null (not a fabricated ₹0) when the viewer has no entries here.
        netByPair.set(key, viewerTotal?.hasEntries ? viewerTotal.netInr : null);
        settledRoundsByPair.set(key, viewerTotal?.hasEntries ? viewerTotal.gameweeksEntered : 0);
        // season.rows is sorted descending by gwNumber (lib/gw-season.ts's loadSeasonView
        // contract) — rows[0] is the latest gameweek reached, not an arbitrary row. If that sort
        // order ever changes, this "through GW6" marker silently goes stale.
        throughGwByPair.set(key, season.rows[0]?.gwNumber ?? null);
      } else {
        const { net, settledRounds } = await loadArchiveNetAndCount(admin, pair.leagueId, pair.competitionId, viewerId);
        netByPair.set(key, net);
        settledRoundsByPair.set(key, settledRounds);
      }
    }),
  );

  const participationRows: AnalyticsParticipationRow[] = pairs.map((pair) => {
    const key = `${pair.leagueId}:${pair.competitionId}`;
    return {
      leagueId: pair.leagueId,
      leagueName: leagueById.get(pair.leagueId)?.name ?? pair.leagueId,
      competitionId: pair.competitionId,
      competitionName: pair.competitionName,
      format: pair.format,
      net: netByPair.get(key) ?? null,
      settledRounds: settledRoundsByPair.get(key) ?? 0,
      throughGameweek: throughGwByPair.get(key) ?? null,
    };
  });

  const sections = buildAnalyticsSections(participationRows);
  const allTimeStrip = buildAllTimeStrip(participationRows);

  const myFormByLeague: Record<string, AnalyticsMyForm | null> = {};
  await Promise.all(
    leagues.map(async (league) => {
      const rows = rowsByLeague.get(league.id) ?? [];
      const participation = resolveLeagueParticipation(rows);
      if (participation.status === "none" || !participation.competitionId) {
        myFormByLeague[league.id] = null;
        return;
      }
      if (participation.format === "gameweek") {
        const key = `${league.id}:${participation.competitionId}`;
        const cached = seasonViewByPair.get(key);
        const season = cached ?? (await loadSeasonView(supabase, admin, { league: { id: league.id, name: league.name, slug: league.slug, createdBy: "", status: "active" }, participation }, viewerId));
        const viewerTotal = season.totals.find((t) => t.isViewer) ?? null;
        myFormByLeague[league.id] = buildLiveMyForm(
          league.id,
          participation.competitionId,
          league.name,
          participation.competitionName ?? "",
          viewerTotal,
          season.rows,
        );
      } else {
        const entries = await loadArchiveEntries(admin, league.id, participation.competitionId!, viewerId);
        myFormByLeague[league.id] = buildArchiveMyForm(
          league.id,
          participation.competitionId,
          league.name,
          participation.competitionName ?? "",
          entries,
        );
      }
    }),
  );

  return { leagueOptions: buildLeagueOptions(leagues), sections, myFormByLeague, allTimeStrip };
}
