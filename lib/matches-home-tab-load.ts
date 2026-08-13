import {
  buildLeagueRows,
  loadMatchesTabInternal,
  type MatchesTabLoadContext,
} from "./matches-tab-load";
import type { LeagueRowView } from "./matches-tab";
import { isEligible } from "./gw-eligibility";
import { MATCH_COPY } from "./match-copy";
import type {
  MatchesHomeTabNextGameweek,
  MatchesHomeTabPayload,
  MatchesHomeTabReceipt,
} from "./matches-home-tab";

type Client = Awaited<ReturnType<typeof import("./supabase/server").createClient>>;

export type MatchesHomeTabLoadOptions = {
  requestedScopeSlug?: string;
  now?: Date;
};

type ActivePair = {
  leagueId: string;
  leagueSlug: string;
  leagueName: string;
  leagueEligibleFromGameweekId: string | null;
  memberEligibleFromGameweekId: string | null;
};

function one<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function errorMessage(error: { message?: string } | null): string {
  return error?.message ?? "query-failed";
}

async function loadActivePairs(
  session: Client,
  context: MatchesTabLoadContext,
  userId: string,
): Promise<ActivePair[]> {
  const [{ data: links, error: linksError }, { data: members, error: membersError }] =
    await Promise.all([
      session
        .from("league_competitions")
        .select("league_id, competition_id, status, eligible_from_gameweek_id")
        .eq("competition_id", context.competition.id)
        .eq("status", "active"),
      session
        .from("member_competitions")
        .select("league_id, competition_id, eligible_from_gameweek_id, left_at")
        .eq("competition_id", context.competition.id)
        .eq("user_id", userId)
        .is("left_at", null),
    ]);
  if (linksError) throw new Error(`matches active-pair links: ${errorMessage(linksError)}`);
  if (membersError) throw new Error(`matches active-pair members: ${errorMessage(membersError)}`);

  const activeLinks = new Map(
    (links ?? []).map((link: any) => [link.league_id, link]),
  );
  const activeMembers = new Map(
    (members ?? []).filter((member: any) => member.left_at == null).map((member: any) => [member.league_id, member]),
  );
  const order = new Map(context.leagueRefs.map((league, index) => [league.id, index]));

  return [...activeLinks.values()]
    .flatMap((link: any) => {
      const member = activeMembers.get(link.league_id);
      const league = context.leagueById.get(link.league_id);
      if (!member || !league) return [];
      return [{
        leagueId: league.id,
        leagueSlug: league.slug,
        leagueName: league.name,
        leagueEligibleFromGameweekId: link.eligible_from_gameweek_id ?? null,
        memberEligibleFromGameweekId: member.eligible_from_gameweek_id ?? null,
      }];
    })
    .sort((a, b) => (order.get(a.leagueId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.leagueId) ?? Number.MAX_SAFE_INTEGER));
}

function nextGameweek(
  context: MatchesTabLoadContext,
  activePairs: readonly ActivePair[],
): { gameweek: any; contests: any[] } | null {
  const activeLeagueIds = new Set(activePairs.map((pair) => pair.leagueId));
  return context.gameweeks
    .filter((gameweek: any) => {
      if (gameweek.number <= context.focusRef.number) return false;
      if (!gameweek.deadline_at || new Date(gameweek.deadline_at) <= context.now) return false;
      return context.contestWithCl.some(
        (contest: any) =>
          contest.gameweek_id === gameweek.id &&
          activeLeagueIds.has(contest.league_id) &&
          contest.cl === "CL1",
      );
    })
    .sort((a: any, b: any) => a.number - b.number)
    .map((gameweek: any) => ({
      gameweek,
      contests: context.contestWithCl.filter(
        (contest: any) =>
          contest.gameweek_id === gameweek.id && activeLeagueIds.has(contest.league_id) && contest.cl === "CL1",
      ),
    }))[0] ?? null;
}

async function buildNextGameweek(
  session: Client,
  context: MatchesTabLoadContext,
  userId: string,
  activePairs: readonly ActivePair[],
): Promise<MatchesHomeTabNextGameweek | null> {
  const next = nextGameweek(context, activePairs);
  if (!next) return null;

  const contestIds = next.contests.map((contest) => contest.id);
  const { data: entries, error } = await session
    .from("gameweek_entries")
    .select("id, gameweek_contest_id, league_id, user_id, status")
    .eq("user_id", userId)
    .in("gameweek_contest_id", contestIds);
  if (error) throw new Error(`matches next-gw entries: ${errorMessage(error)}`);

  const entryByContest = new Map(
    (entries ?? []).map((entry: any) => [entry.gameweek_contest_id, entry]),
  );
  const boundaryById = new Map(
    context.gameweeks.map((gameweek: any) => [gameweek.id, gameweek.number]),
  );
  const contestByLeague = new Map(
    next.contests.map((contest: any) => [contest.league_id, contest]),
  );

  return {
    number: next.gameweek.number,
    deadlineAt: next.gameweek.deadline_at,
    leagues: activePairs.map((pair) => {
      const contest = contestByLeague.get(pair.leagueId);
      const eligible = isEligible(
        {
          leagueEligibleFromNumber: pair.leagueEligibleFromGameweekId
            ? boundaryById.get(pair.leagueEligibleFromGameweekId) ?? null
            : null,
          memberEligibleFromNumber: pair.memberEligibleFromGameweekId
            ? boundaryById.get(pair.memberEligibleFromGameweekId) ?? null
            : null,
          leftAt: null,
        },
        next.gameweek.number,
      );
      const entry = contest ? entryByContest.get(contest.id) : null;
      const status = !eligible
        ? "ineligible"
        : entry?.status === "entered"
          ? "complete"
          : entry?.status === "needs_update"
            ? "needs_update"
            : "none";
      return {
        leagueSlug: pair.leagueSlug,
        leagueName: pair.leagueName,
        status,
        enterHref: `/leagues/${pair.leagueSlug}/enter?gw=${next.gameweek.number}`,
      };
    }),
  };
}

const UNRESOLVED = new Set(["CL2", "CL3", "CL4", "CL6", "CL8", "CL9", "CL10"]);

function freshnessFor(context: MatchesTabLoadContext): "settled" | "pre" | "unresolved" {
  if (context.focusContests.some((contest: any) => UNRESOLVED.has(contest.cl))) return "unresolved";
  if (
    context.focusContests.length > 0 &&
    context.focusContests.every((contest: any) => contest.cl === "CL5" || contest.cl === "CL7")
  ) {
    return "settled";
  }
  return "pre";
}

function previousResolved(
  context: MatchesTabLoadContext,
  activePairs: readonly ActivePair[],
): { gameweek: any; contests: any[] } | null {
  if (context.view.gw.state !== "pre") return null;
  if (context.focusContests.some((contest: any) => UNRESOLVED.has(contest.cl))) return null;
  if (context.focusContests.length > 0 && context.focusContests.every((contest: any) => contest.cl === "CL5" || contest.cl === "CL7")) return null;

  const previous = context.gameweeks.find(
    (gameweek: any) => gameweek.number === context.focusRef.number - 1,
  );
  if (!previous || activePairs.length === 0) return null;
  const activeLeagueIds = new Set(activePairs.map((pair) => pair.leagueId));
  const contests = context.contestWithCl.filter(
    (contest: any) =>
      contest.gameweek_id === previous.id &&
      activeLeagueIds.has(contest.league_id),
  );
  if (contests.length !== activePairs.length) return null;
  if (!contests.every((contest: any) => contest.cl === "CL5" || contest.cl === "CL7")) return null;
  return { gameweek: previous, contests };
}

async function buildReceipt(
  session: Client,
  context: MatchesTabLoadContext,
  userId: string,
  activePairs: readonly ActivePair[],
): Promise<MatchesHomeTabReceipt | null> {
  const resolved = previousResolved(context, activePairs);
  if (!resolved) return null;

  const contestIds = resolved.contests.map((contest) => contest.id);
  const [
    { data: entries, error: entriesError },
    { data: entryResults, error: entryResultsError },
  ] = await Promise.all([
    session
      .from("gameweek_entries")
      .select("id, gameweek_contest_id, league_id, user_id, status, profiles(display_name,username)")
      .in("gameweek_contest_id", contestIds),
    session
      .from("gameweek_entry_results")
      .select("*")
      .in("gameweek_contest_id", contestIds),
  ]);
  if (entriesError) throw new Error(`matches receipt entries: ${errorMessage(entriesError)}`);
  if (entryResultsError) throw new Error(`matches receipt entry-results: ${errorMessage(entryResultsError)}`);

  const activeScopeByLeague = new Map(
    activePairs.map((pair) => [
      pair.leagueId,
      { eligible_from_gameweek_id: pair.leagueEligibleFromGameweekId, status: "active" },
    ]),
  );
  const activeMemberByLeague = new Map(
    activePairs.map((pair) => [
      pair.leagueId,
      { eligible_from_gameweek_id: pair.memberEligibleFromGameweekId, left_at: null },
    ]),
  );
  const rows = buildLeagueRows({
    contests: resolved.contests,
    entries: entries ?? [],
    entryResults: entryResults ?? [],
    userId,
    focusRef: resolved.gameweek,
    gameweeks: context.gameweeks,
    leagueById: context.leagueById,
    scopeByLeague: activeScopeByLeague,
    memberScopeByLeague: activeMemberByLeague,
    boundaryById: context.boundaryById,
    resultByContest: context.resultByContest,
    liveByContest: new Map(),
  });
  const summary = buildReceiptSummary(resolved.gameweek.number, rows);
  if (!summary) return null;
  return {
    gwNumber: resolved.gameweek.number,
    summary,
    rows,
    href: `/matches?gw=${resolved.gameweek.number}`,
  };
}

export function buildReceiptSummary(gwNumber: number, rows: readonly LeagueRowView[]): string | null {
  const counted = rows.filter(
    (row): row is Extract<LeagueRowView, { kind: "settled" | "void" }> =>
      row.kind === "settled" || row.kind === "void",
  );
  if (counted.length >= 2) {
    if (counted.every((row) => row.kind === "settled")) {
      const settled = counted as Array<Extract<LeagueRowView, { kind: "settled" }>>;
      return MATCH_COPY.receiptMultipleNet(
        gwNumber,
        settled.length,
        settled.reduce((sum, row) => sum + row.netInr, 0),
      );
    }
    return MATCH_COPY.receiptMultiple(gwNumber, counted.length);
  }
  if (counted.length === 1) {
    const row = counted[0];
    if (row.kind === "void") return MATCH_COPY.receiptVoid(gwNumber);
    return MATCH_COPY.receiptRanked(
      gwNumber,
      row.ordinal ?? null,
      row.fieldSize ?? null,
      row.points ?? null,
      row.netInr ?? null,
    );
  }
  const invalidCount = rows.filter((row) => row.kind === "invalid").length;
  if (invalidCount > 0) return MATCH_COPY.receiptEntryNotCounted(gwNumber, invalidCount);
  if (rows.some((row) => row.kind === "closed-not-entered")) return MATCH_COPY.receiptSatOut(gwNumber);
  return null;
}

export async function loadMatchesHomeTab(
  session: Client,
  userId: string,
  options: MatchesHomeTabLoadOptions = {},
): Promise<MatchesHomeTabPayload> {
  const requestedComp = options.requestedScopeSlug ?? null;
  const now = options.now ?? new Date();
  const context = await loadMatchesTabInternal(
    session,
    userId,
    undefined,
    now,
    options.requestedScopeSlug,
    { strictScope: true, strictReadErrors: true },
  );
  if (!context) {
    return {
      empty: true,
      requestedComp,
      selectedComp: null,
      freshness: "empty",
    };
  }

  const activePairs = await loadActivePairs(session, context, userId);
  const [nextGw, receipt] = await Promise.all([
    buildNextGameweek(session, context, userId, activePairs),
    buildReceipt(session, context, userId, activePairs),
  ]);
  return {
    empty: false,
    requestedComp,
    selectedComp: context.view.selectedScope,
    view: context.view,
    freshness: freshnessFor(context),
    nextGw,
    receipt,
  };
}
