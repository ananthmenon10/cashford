import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entry } from "./analytics";
import { loadDuesView, type DuesView } from "./dues-view";
import type { LeagueIdentity } from "./gw-view";
import { loadKnockoutLeaderboards, loadKnockoutView } from "./knockout-data";
import { ARCHIVE_COPY } from "./payment-copy";
import { buildWcFinalStandings, combinedBalanceParts, countSettledFixtures, type WcArchiveStanding } from "./wc-archive";

export type WcArchiveBalance = { prefix: string; amount: string | null; sign: "positive" | "negative" | "zero" };
export type WcLiveCompetition = { name: string; href: string };

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/** Shared across all three archive routes (analytics/matches/bracket) — every route shows the
 * same "Open <live competition> →" exit link when the league has an active PL competition. */
async function loadLiveCompetition(admin: CashfordClient, leagueId: string, slug: string) {
  const pl = await admin
    .from("competitions")
    .select("id, name, status")
    .eq("slug", "pl-2026-27")
    .maybeSingle();
  fail(pl.error, "wc-archive-pl-competition");
  const plParticipation = pl.data
    ? await admin
        .from("league_competitions")
        .select("competition_id")
        .eq("league_id", leagueId)
        .eq("competition_id", pl.data.id)
        .maybeSingle()
    : { data: null, error: null };
  fail(plParticipation.error, "wc-archive-pl-participation");
  const liveCompetition: WcLiveCompetition | null =
    pl.data?.status === "active" && plParticipation.data
      ? { name: pl.data.name ?? ARCHIVE_COPY.plReturn, href: `/leagues/${slug}` }
      : null;
  return { pl, plParticipation, liveCompetition };
}

export type WcArchivePageLoad = {
  dues: DuesView;
  standings: WcArchiveStanding[];
  mine: WcArchiveStanding | null;
  pl: { id: string; name: string; status: string } | null;
  plParticipation: { competition_id: string } | null;
  leagueConfig: { default_stake_inr: number } | null;
  nextPl: { number: number; deadline_at: string } | null;
  balance: WcArchiveBalance | undefined;
  matchesSettled: number;
  liveCompetition: WcLiveCompetition | null;
};

/** The server-side read path used by app/leagues/[slug]/archive/wc2026/page.tsx. */
export async function loadWcArchivePage(
  session: CashfordClient,
  admin: CashfordClient,
  identity: LeagueIdentity,
  userId: string,
): Promise<WcArchivePageLoad> {
  const dues = await loadDuesView(session as any, admin as any, identity, userId);
  const wc = await admin
    .from("competitions")
    .select("id")
    .eq("slug", "wc2026")
    .single();
  fail(wc.error, "wc-archive-competition");
  if (!wc.data) throw new Error("wc-archive-competition: missing wc2026");
  const wcId = wc.data.id;

  const membersQ = await admin
    .from("league_members")
    .select("user_id")
    .eq("league_id", identity.league.id);
  fail(membersQ.error, "wc-archive-members");

  const resultQ = await admin
    .from("contest_results")
    .select(
      "user_id, net_inr, contests!inner(league_id, fixture_id, fixtures!inner(competition_id, external_id, kickoff_at, ft_home, ft_away, is_knockout, advancer_team_id))",
    )
    .eq("contests.league_id", identity.league.id)
    .eq("contests.fixtures.competition_id", wcId);
  fail(resultQ.error, "wc-archive-results");

  const memberIds = (membersQ.data ?? []).map((row: any) => row.user_id as string);
  const profiles = memberIds.length
    ? await admin
        .from("profiles")
        .select("id, display_name, username")
        .in("id", memberIds)
    : { data: [], error: null };
  fail(profiles.error, "wc-archive-profiles");
  const names = new Map(
    (profiles.data ?? []).map((row: any) => [
      row.id as string,
      (row.display_name ?? row.username) as string,
    ]),
  );

  const net = new Map<string, number>();
  const resultByKey = new Map<string, number>();
  const resultFixtureIds: string[] = [];
  for (const row of (resultQ.data ?? []) as any[]) {
    const contest = one<any>(row.contests);
    net.set(row.user_id, (net.get(row.user_id) ?? 0) + Number(row.net_inr ?? 0));
    resultByKey.set(`${contest.id}:${row.user_id}`, Number(row.net_inr ?? 0));
    if (contest?.fixture_id) resultFixtureIds.push(contest.fixture_id);
  }
  const matchesSettled = countSettledFixtures(resultFixtureIds);

  const predictions = await admin
    .from("predictions")
    .select(
      "user_id, outcome, pred_home, pred_away, contests!inner(id, league_id, fixtures!inner(id, kickoff_at, home_label, away_label, ft_home, ft_away, is_knockout, advancer_team_id, competition_id))",
    )
    .eq("contests.league_id", identity.league.id)
    .eq("contests.fixtures.competition_id", wcId);
  fail(predictions.error, "wc-archive-predictions");

  const entriesByUser = new Map<string, Entry[]>();
  const unavailableUserIds = new Set<string>();
  for (const row of (predictions.data ?? []) as any[]) {
    const contest = one<any>(row.contests);
    const fixture = one<any>(contest?.fixtures);
    if (fixture?.ft_home == null || fixture?.ft_away == null) {
      unavailableUserIds.add(row.user_id);
      continue;
    }
    const list = entriesByUser.get(row.user_id) ?? [];
    list.push({
      outcome: row.outcome,
      predHome: row.pred_home,
      predAway: row.pred_away,
      ftHome: fixture.ft_home,
      ftAway: fixture.ft_away,
      isKnockout: fixture.is_knockout,
      advancer: null,
      net: resultByKey.get(`${contest.id}:${row.user_id}`) ?? null,
      kickoffMs: new Date(fixture.kickoff_at).getTime(),
      dayKey: "",
      homeLabel: fixture.home_label ?? "Home",
      awayLabel: fixture.away_label ?? "Away",
    });
    entriesByUser.set(row.user_id, list);
  }

  const standings = buildWcFinalStandings({
    members: memberIds.map((userId) => ({ userId, name: names.get(userId) ?? "player" })),
    entriesByUser,
    netByUser: net,
    unavailableUserIds: [...unavailableUserIds],
  });

  const { pl, plParticipation, liveCompetition } = await loadLiveCompetition(
    admin,
    identity.league.id,
    identity.league.slug,
  );
  const leagueConfig = await admin
    .from("leagues")
    .select("default_stake_inr")
    .eq("id", identity.league.id)
    .maybeSingle();
  fail(leagueConfig.error, "wc-archive-league-config");
  const nextPl = pl.data
    ? await admin
        .from("gameweeks")
        .select("number, deadline_at")
        .eq("competition_id", pl.data.id)
        .eq("status", "open")
        .gt("deadline_at", new Date().toISOString())
        .order("number", { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };
  fail(nextPl.error, "wc-archive-next-gameweek");

  const mine = standings.find((row) => row.userId === userId) ?? null;
  const balance =
    dues.ledger.status === "clean"
      ? combinedBalanceParts(dues.ledger.netByUser[userId] ?? 0)
      : undefined;
  return {
    dues,
    standings,
    mine,
    pl: pl.data,
    plParticipation: plParticipation.data,
    leagueConfig: leagueConfig.data,
    nextPl: nextPl.data,
    balance,
    matchesSettled,
    liveCompetition,
  };
}

export type WcArchiveMatchRow = {
  id: string;
  status: string;
  stake_inr: number;
  fixtures: any;
};

export type WcArchiveMatchesPageLoad = {
  dues: DuesView;
  balance: WcArchiveBalance | undefined;
  rows: WcArchiveMatchRow[];
  predictions: Map<string, any>;
  results: Map<string, number>;
  liveCompetition: WcLiveCompetition | null;
};

export type WcArchiveBracketPageLoad = {
  dues: DuesView;
  view: Awaited<ReturnType<typeof loadKnockoutView>>;
  boards: Awaited<ReturnType<typeof loadKnockoutLeaderboards>>;
  balance: WcArchiveBalance | undefined;
  liveCompetition: WcLiveCompetition | null;
};

/** The server-side read path used by the archive bracket page. */
export async function loadWcArchiveBracketPage(
  session: CashfordClient,
  admin: CashfordClient,
  identity: LeagueIdentity,
  userId: string,
): Promise<WcArchiveBracketPageLoad> {
  const dues = await loadDuesView(session as any, admin as any, identity, userId);
  const view = await loadKnockoutView(session as any, userId);
  const boards = await loadKnockoutLeaderboards(session as any, userId, view.results);
  const balance =
    dues.ledger.status === "clean"
      ? combinedBalanceParts(dues.ledger.netByUser[userId] ?? 0)
      : undefined;
  const { liveCompetition } = await loadLiveCompetition(admin, identity.league.id, identity.league.slug);
  return { dues, view, boards, balance, liveCompetition };
}

/** The server-side read path used by the archive matches page. */
export async function loadWcArchiveMatchesPage(
  session: CashfordClient,
  admin: CashfordClient,
  identity: LeagueIdentity,
  userId: string,
): Promise<WcArchiveMatchesPageLoad> {
  const dues = await loadDuesView(session as any, admin as any, identity, userId);
  const wc = await admin
    .from("competitions")
    .select("id")
    .eq("slug", "wc2026")
    .single();
  fail(wc.error, "wc-matches-competition");
  if (!wc.data) throw new Error("wc-matches-competition: missing wc2026");
  const wcId = wc.data.id;
  const query = await admin
    .from("contests")
    .select(
      "id, status, stake_inr, fixtures!inner(id, round, kickoff_at, home_label, away_label, home_team_id, away_team_id, ft_home, ft_away, status, competition_id, is_knockout, advancer_team_id)",
    )
    .eq("league_id", identity.league.id)
    .eq("fixtures.competition_id", wcId);
  fail(query.error, "wc-matches");
  const contestIds = (query.data ?? []).map((row: any) => row.id as string);
  const [predictionsQ, resultsQ] = contestIds.length
    ? await Promise.all([
        admin
          .from("predictions")
          .select("contest_id, outcome, pred_home, pred_away")
          .eq("user_id", userId)
          .in("contest_id", contestIds),
        admin
          .from("contest_results")
          .select("contest_id, net_inr")
          .eq("user_id", userId)
          .in("contest_id", contestIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }] as const;
  fail(predictionsQ.error, "wc-matches-predictions");
  fail(resultsQ.error, "wc-matches-results");
  const predictions = new Map(
    (predictionsQ.data ?? []).map((row: any) => [row.contest_id, row]),
  );
  const results = new Map(
    (resultsQ.data ?? []).map((row: any) => [row.contest_id, Number(row.net_inr)]),
  );
  const rows = [...(query.data ?? [])].sort(
    (a: any, b: any) =>
      new Date(one<any>(b.fixtures)?.kickoff_at).getTime() -
      new Date(one<any>(a.fixtures)?.kickoff_at).getTime(),
  ) as WcArchiveMatchRow[];
  const balance =
    dues.ledger.status === "clean"
      ? combinedBalanceParts(dues.ledger.netByUser[userId] ?? 0)
      : undefined;
  const { liveCompetition } = await loadLiveCompetition(admin, identity.league.id, identity.league.slug);
  return { dues, balance, rows, predictions, results, liveCompetition };
}
