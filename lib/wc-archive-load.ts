import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entry } from "./analytics";
import { loadDuesView, type DuesView } from "./dues-view";
import type { LeagueIdentity } from "./gw-view";
import { formatIstDate } from "./ist";
import { loadKnockoutLeaderboards, loadKnockoutView } from "./knockout-data";
import type { TransitionState } from "./transition";
import { buildWcFinalStandings, combinedBalanceParts, countSettledFixtures, isLateMember, type WcArchiveStanding } from "./wc-archive";
import { loadLiveCompetition, resolveWcTransition, type WcLiveCompetition } from "./wc-live-competition";
import { compareFixtureKickoff } from "./fixture-order";

export type { WcLiveCompetition };
export { loadLiveCompetition, resolveWcTransition };

export type WcArchiveBalance = { prefix: string; amount: string | null; sign: "positive" | "negative" | "zero" };

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export type WcArchivePageLoad = {
  dues: DuesView;
  standings: WcArchiveStanding[];
  lateMembers: { userId: string; name: string }[];
  mine: WcArchiveStanding | null;
  mineIsLate: boolean;
  pl: { id: string; slug: string; name: string; status: string } | null;
  plParticipation: { competition_id: string } | null;
  leagueConfig: { default_stake_inr: number } | null;
  nextPl: { number: number; deadline_at: string } | null;
  balance: WcArchiveBalance | undefined;
  matchesSettled: number;
  liveCompetition: WcLiveCompetition | null;
  transition: TransitionState;
  freezeDate: string | null;
  captainName: string;
  otherActiveCompetitionName: string | null;
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
    .select("user_id, joined_at, left_at")
    .eq("league_id", identity.league.id);
  fail(membersQ.error, "wc-archive-members");

  const resultQ = await admin
    .from("contest_results")
    .select(
      // "id" is included deliberately — resultByKey below keys on contests.id per user, and the
      // dormant bug this fixes was this exact select omitting it: every key silently collapsed
      // to "undefined:<user>", so any recap stat built from resultByKey was always null.
      "user_id, net_inr, contests!inner(id, league_id, fixture_id, settled_at, fixtures!inner(competition_id, external_id, kickoff_at, ft_home, ft_away, is_knockout, advancer_team_id))",
    )
    .eq("contests.league_id", identity.league.id)
    .eq("contests.fixtures.competition_id", wcId);
  fail(resultQ.error, "wc-archive-results");

  const memberIds = (membersQ.data ?? []).map((row: any) => row.user_id as string);
  const joinedAtByUser = new Map(
    (membersQ.data ?? []).map((row: any) => [row.user_id as string, row.joined_at as string]),
  );
  const pastMemberIds = new Set(
    (membersQ.data ?? []).filter((row: any) => row.left_at).map((row: any) => row.user_id as string),
  );
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
  let freezeAt: string | null = null;
  for (const row of (resultQ.data ?? []) as any[]) {
    const contest = one<any>(row.contests);
    net.set(row.user_id, (net.get(row.user_id) ?? 0) + Number(row.net_inr ?? 0));
    resultByKey.set(`${contest.id}:${row.user_id}`, Number(row.net_inr ?? 0));
    if (contest?.fixture_id) resultFixtureIds.push(contest.fixture_id);
    if (contest?.settled_at && (!freezeAt || contest.settled_at > freezeAt)) freezeAt = contest.settled_at;
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

  // Item 3 (AC8): members who joined after the WC's last settlement never lived through it —
  // exclude them from the ranked standings entirely rather than giving them a fabricated
  // "Finish #N · 0 correct · 0 exact" line built from history they weren't there for.
  //
  // Dual-review fix (R2 F6): computed after entriesByUser so a member who joined late but
  // still has entries (they played, even if unsettled) isn't wrongly classified as late.
  const lateMemberIds = new Set(
    memberIds.filter((userId) =>
      isLateMember(joinedAtByUser.get(userId), freezeAt, (entriesByUser.get(userId) ?? []).length),
    ),
  );
  const eligibleMemberIds = memberIds.filter((userId) => !lateMemberIds.has(userId));
  const lateMembers = memberIds
    .filter((userId) => lateMemberIds.has(userId))
    .map((userId) => ({ userId, name: names.get(userId) ?? "player" }));

  const standings = buildWcFinalStandings({
    members: eligibleMemberIds.map((userId) => ({
      userId,
      name: names.get(userId) ?? "player",
      isPastMember: pastMemberIds.has(userId),
    })),
    entriesByUser,
    netByUser: net,
    unavailableUserIds: [...unavailableUserIds],
  });

  const { pl, plParticipation, liveCompetition, otherActiveCompetition, otherActiveCompetitionName, participationStatus } = await loadLiveCompetition(
    admin,
    identity.league.id,
    identity.league.slug,
  );
  const isCaptain = identity.league.createdBy === userId;
  const transition = resolveWcTransition(
    { pl: pl.data, participationStatus, otherActiveCompetition, leagueStatus: identity.league.status },
    isCaptain,
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
  const mineIsLate = lateMemberIds.has(userId);
  const balance =
    dues.ledger.status === "clean"
      ? combinedBalanceParts(dues.ledger.netByUser[userId] ?? 0)
      : undefined;
  const freezeDate = freezeAt ? formatIstDate(freezeAt) : null;
  const captainName = names.get(identity.league.createdBy) ?? "The captain";
  return {
    dues,
    standings,
    lateMembers,
    mine,
    mineIsLate,
    pl: pl.data,
    plParticipation: plParticipation.data,
    leagueConfig: leagueConfig.data,
    nextPl: nextPl.data,
    balance,
    matchesSettled,
    liveCompetition,
    transition,
    freezeDate,
    captainName,
    otherActiveCompetitionName,
  };
}

export type WcArchiveMatchRow = {
  id: string;
  status: string;
  stake_inr: number;
  fixtures: any;
};

export function sortWcArchiveMatchRows(
  rows: readonly WcArchiveMatchRow[],
): WcArchiveMatchRow[] {
  return [...rows].sort((a, b) => {
    const left = one<any>(a.fixtures);
    const right = one<any>(b.fixtures);
    return compareFixtureKickoff(
      {
        id: left?.id ?? a.id,
        kickoffAt: left?.kickoff_at ?? null,
        externalId: left?.external_id ?? null,
      },
      {
        id: right?.id ?? b.id,
        kickoffAt: right?.kickoff_at ?? null,
        externalId: right?.external_id ?? null,
      },
    );
  });
}

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
      "id, status, stake_inr, fixtures!inner(id, external_id, round, kickoff_at, home_label, away_label, home_team_id, away_team_id, ft_home, ft_away, status, competition_id, is_knockout, advancer_team_id)",
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
  const rows = sortWcArchiveMatchRows((query.data ?? []) as WcArchiveMatchRow[]);
  const balance =
    dues.ledger.status === "clean"
      ? combinedBalanceParts(dues.ledger.netByUser[userId] ?? 0)
      : undefined;
  const { liveCompetition } = await loadLiveCompetition(admin, identity.league.id, identity.league.slug);
  return { dues, balance, rows, predictions, results, liveCompetition };
}
