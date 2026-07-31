import type { SupabaseClient } from "@supabase/supabase-js";
import {
  collapseGameweekFixtures,
  type EffectiveGameweekFixture,
} from "./gw-fixtures";
import { entryPotNumbers, isEligible } from "./gw-eligibility";
import { provisionalGameweek } from "./gw-live";
import {
  resolveContestLifecycle,
  resolveRender,
  resolveViewerParticipation,
  type ContestLifecycle,
  type ViewerParticipation,
} from "./gw-state";
import {
  resolveLeagueParticipation,
  type LeagueParticipationRow,
  type ResolvedLeagueParticipation,
} from "./gw-participation";
import { nudgeMessage } from "./gw-copy";
import { formatIstDeadline } from "./ist";

export type GameweekContestCandidate = {
  gwNumber: number;
  gameweekContestId: string;
  status: "open" | "locked" | "settling" | "settled" | "void";
  deadlineAt: string;
};

export function resolveGameweekView<T extends GameweekContestCandidate>(
  candidates: readonly T[],
  requestedGameweek: string | number | null | undefined,
  now: Date | string | number = new Date(),
): T | null {
  const requested =
    typeof requestedGameweek === "number"
      ? requestedGameweek
      : typeof requestedGameweek === "string" && requestedGameweek.trim() !== ""
        ? Number(requestedGameweek)
        : null;
  if (requested != null && Number.isInteger(requested)) {
    const exact = candidates.find((candidate) => candidate.gwNumber === requested);
    if (exact) return exact;
  }

  const at = new Date(now).getTime();
  const openFuture = candidates
    .filter(
      (candidate) =>
        candidate.status === "open" &&
        new Date(candidate.deadlineAt).getTime() > at,
    )
    .sort(
      (a, b) =>
        new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime(),
    )[0];
  if (openFuture) return openFuture;

  const cronLag = candidates
    .filter(
      (candidate) =>
        candidate.status === "open" &&
        new Date(candidate.deadlineAt).getTime() <= at,
    )
    .sort(
      (a, b) =>
        new Date(b.deadlineAt).getTime() - new Date(a.deadlineAt).getTime(),
    )[0];
  if (cronLag) return cronLag;

  return (
    candidates
      .filter((candidate) =>
        ["locked", "settling", "settled", "void"].includes(candidate.status),
      )
      .sort(
        (a, b) =>
          new Date(b.deadlineAt).getTime() - new Date(a.deadlineAt).getTime(),
      )[0] ?? null
  );
}

export function buildGameweekViewDTO<T extends {
  cl: ContestLifecycle;
  snapshotEntryResults?: unknown;
  [key: string]: unknown;
}>(input: T): Omit<T, "snapshotEntryResults"> & { entryResults?: unknown } {
  const { snapshotEntryResults, ...rest } = input;
  if (input.cl === "CL6" || input.cl === "CL8") return rest;
  return snapshotEntryResults === undefined
    ? rest
    : { ...rest, entryResults: snapshotEntryResults };
}

type CashfordClient = SupabaseClient<any, "cashford", any>;

export type GameweekViewFixture = {
  fixtureId: string;
  membershipId: string;
  state: "active" | "void";
  voidReason: string | null;
  kickoffAt: string | null;
  status: string;
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
  homeName: string;
  awayName: string;
  homeShort: string;
  awayShort: string;
};

export type GameweekStanding = {
  userId: string;
  name: string;
  points: number | null;
  exacts: number | null;
  goalError: number | null;
  rank: number | null;
  netInr?: number;
  status: string;
  isViewer: boolean;
};

export type GameweekViewDTO = {
  league: {
    id: string;
    name: string;
    slug: string;
    createdBy: string;
    status: string;
  };
  participation: ResolvedLeagueParticipation;
  competition: { id: string; name: string; format: "league" };
  gameweek: {
    id: string;
    number: number;
    name: string;
    status: string;
    deadlineAt: string;
  } | null;
  adjacentGameweeks: {
    number: number;
    name: string;
    hasContest: boolean;
  }[];
  contest: {
    id: string;
    status: string;
    stakeInr: number;
    deadlineAt: string;
    inputVersion: number;
  } | null;
  lifecycle: ContestLifecycle;
  viewerParticipation: ViewerParticipation;
  render: ReturnType<typeof resolveRender>;
  fixtures: GameweekViewFixture[];
  viewerEntry: {
    id: string;
    status: "entered" | "needs_update" | "locked_in" | "invalid";
  } | null;
  viewerPicks: { fixtureId: string; predHome: number; predAway: number }[];
  revealedPicks: {
    userId: string;
    fixtureId: string;
    predHome: number;
    predAway: number;
  }[];
  standings: GameweekStanding[];
  result: {
    outcome: "settled" | "void";
    voidReason: "no_entrants" | "single_entrant" | "all_fixtures_void" | null;
    tiebreakUsed: string | null;
    settledVersion: number;
    lastSettleCause: "initial" | "result_revision" | "membership_change" | "combined";
  } | null;
  enteredCount: number;
  eligibleCount: number;
  potInr: number;
  isDoubleGameweek: boolean;
  viewerEligibleFromGameweekNumber: number | null;
  nudge: { href: string; copy: string } | null;
};

export type MirrorTarget = {
  leagueId: string;
  leagueName: string;
  acceptedStakeInr: number;
};

export type LeagueIdentity = {
  league: GameweekViewDTO["league"];
  participation: ResolvedLeagueParticipation;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

export async function loadLeagueIdentity(
  supabase: CashfordClient,
  slug: string,
): Promise<LeagueIdentity | null> {
  const leagueQuery = await supabase
    .from("leagues")
    .select("id, name, slug, created_by, status")
    .eq("slug", slug)
    .maybeSingle();
  fail(leagueQuery.error, "league-identity");
  if (!leagueQuery.data) return null;

  const participationQuery = await supabase
    .from("league_competitions")
    .select(
      "competition_id, status, joined_at, eligible_from_gameweek_id, competitions!inner(id, name, slug, format, status)",
    )
    .eq("league_id", leagueQuery.data.id)
    .order("joined_at", { ascending: false });
  fail(participationQuery.error, "league-participation");

  return {
    league: {
      id: leagueQuery.data.id,
      name: leagueQuery.data.name,
      slug: leagueQuery.data.slug,
      createdBy: leagueQuery.data.created_by,
      status: leagueQuery.data.status,
    },
    participation: resolveLeagueParticipation(
      (participationQuery.data ?? []) as LeagueParticipationRow[],
    ),
  };
}

type ContestDbRow = {
  id: string;
  gameweek_id: string;
  status: GameweekContestCandidate["status"];
  stake_inr: number;
  deadline_at: string;
  input_version: number;
};

type GameweekDbRow = {
  id: string;
  competition_id: string;
  number: number;
  name: string;
  status: string;
  deadline_at: string;
};

export async function loadGameweekView(
  supabase: CashfordClient,
  admin: CashfordClient,
  identity: LeagueIdentity,
  userId: string,
  requestedGameweek?: string | number | null,
  now: Date | string | number = new Date(),
  loadDepartedNames = true,
): Promise<GameweekViewDTO> {
  if (
    identity.participation.status === "none" ||
    identity.participation.format !== "gameweek"
  ) {
    throw new Error("gameweek-view-format");
  }
  const participation = identity.participation;

  const contestQuery = await supabase
    .from("gameweek_contests")
    .select(
      "id, gameweek_id, competition_id, status, stake_inr, deadline_at, input_version",
    )
    .eq("league_id", identity.league.id)
    .eq("competition_id", participation.competitionId!);
  fail(contestQuery.error, "gameweek-contests");

  const gameweekQuery = await supabase
    .from("gameweeks")
    .select("id, competition_id, number, name, status, deadline_at")
    .eq("competition_id", participation.competitionId!)
    .order("number", { ascending: true });
  fail(gameweekQuery.error, "competition-gameweeks");

  const contests = (contestQuery.data ?? []) as ContestDbRow[];
  const gameweeks = (gameweekQuery.data ?? []) as GameweekDbRow[];
  const gameweekById = new Map(gameweeks.map((row) => [row.id, row]));
  const candidates = contests.flatMap((contest) => {
    const gameweek = gameweekById.get(contest.gameweek_id);
    return gameweek
      ? [{
          gwNumber: gameweek.number,
          gameweekContestId: contest.id,
          status: contest.status,
          deadlineAt: contest.deadline_at,
        }]
      : [];
  });
  const selected = resolveGameweekView(candidates, requestedGameweek, now);
  const contest = selected
    ? contests.find((row) => row.id === selected.gameweekContestId) ?? null
    : null;
  const gameweek = contest ? gameweekById.get(contest.gameweek_id) ?? null : null;

  const emptyBase = {
    league: identity.league,
    participation,
    competition: {
      id: participation.competitionId!,
      name: participation.competitionName!,
      format: "league" as const,
    },
    adjacentGameweeks: gameweeks.map((row) => ({
      number: row.number,
      name: row.name,
      hasContest: contests.some((candidate) => candidate.gameweek_id === row.id),
    })),
  };

  if (!contest || !gameweek) {
    return {
      ...emptyBase,
      gameweek: null,
      contest: null,
      lifecycle: "CL0",
      viewerParticipation: "VP0",
      render: resolveRender("CL0", "VP0"),
      fixtures: [],
      viewerEntry: null,
      viewerPicks: [],
      revealedPicks: [],
      standings: [],
      result: null,
      enteredCount: 0,
      eligibleCount: 0,
      potInr: 0,
      isDoubleGameweek: false,
      viewerEligibleFromGameweekNumber: null,
      nudge: null,
    };
  }

  const [
    fixtureMembershipQuery,
    viewerEntryQuery,
    entriesQuery,
    memberCompetitionQuery,
    resultQuery,
  ] = await Promise.all([
    supabase
      .from("gameweek_fixtures")
      .select(
        "id, fixture_id, state, is_current, void_reason, fixtures!gameweek_fixtures_fixture_id_competition_id_fkey(id, kickoff_at, status, minute, ft_home, ft_away, home_label, away_label, home_team:teams!fixtures_home_team_id_fkey(id, name, short_name), away_team:teams!fixtures_away_team_id_fkey(id, name, short_name))",
      )
      .eq("gameweek_id", gameweek.id)
      .order("added_at", { ascending: true }),
    supabase
      .from("gameweek_entries")
      .select("id, status")
      .eq("gameweek_contest_id", contest.id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("gameweek_entries")
      .select("id, user_id, status, profiles(display_name, username)")
      .eq("gameweek_contest_id", contest.id),
    supabase
      .from("member_competitions")
      .select("user_id, eligible_from_gameweek_id, left_at")
      .eq("league_id", identity.league.id)
      .eq("competition_id", participation.competitionId!),
    supabase
      .from("gameweek_results")
      .select(
        "outcome, void_reason, tiebreak_used, settled_version, last_settle_cause",
      )
      .eq("gameweek_contest_id", contest.id)
      .maybeSingle(),
  ]);
  fail(fixtureMembershipQuery.error, "gameweek-fixtures");
  fail(viewerEntryQuery.error, "viewer-entry");
  fail(entriesQuery.error, "gameweek-entry-counts");
  fail(memberCompetitionQuery.error, "eligible-members");
  fail(resultQuery.error, "gameweek-result");

  const viewerEntry = viewerEntryQuery.data as {
    id: string;
    status: "entered" | "needs_update" | "locked_in" | "invalid";
  } | null;
  const viewerPicksQuery = viewerEntry
    ? await supabase
        .from("gameweek_picks")
        .select("fixture_id, pred_home, pred_away")
        .eq("entry_id", viewerEntry.id)
    : { data: [], error: null };
  fail(viewerPicksQuery.error, "viewer-picks");

  const effective = collapseGameweekFixtures(
    (fixtureMembershipQuery.data ?? []).map((row: any) => ({
      fixtureId: row.fixture_id,
      state: row.state,
      membershipId: row.id,
      voidReason: row.void_reason,
      fixture: one(row.fixtures),
    })),
  );
  const fixtures: GameweekViewFixture[] = effective.map(
    (row: EffectiveGameweekFixture<any>) => {
      const fixture = row.fixture ?? {};
      const home = one<any>(fixture.home_team);
      const away = one<any>(fixture.away_team);
      return {
        fixtureId: row.fixtureId,
        membershipId: row.membershipId ?? "",
        state: row.state,
        voidReason: row.voidReason ?? null,
        kickoffAt: fixture.kickoff_at ?? null,
        status: fixture.status ?? "scheduled",
        minute: fixture.minute ?? null,
        homeScore: fixture.ft_home ?? null,
        awayScore: fixture.ft_away ?? null,
        homeName: home?.name ?? fixture.home_label ?? "Home",
        awayName: away?.name ?? fixture.away_label ?? "Away",
        homeShort: home?.short_name ?? home?.name ?? fixture.home_label ?? "Home",
        awayShort: away?.short_name ?? away?.name ?? fixture.away_label ?? "Away",
      };
    },
  );

  const resultRow = resultQuery.data as any;
  const result = resultRow
    ? {
        outcome: resultRow.outcome as "settled" | "void",
        voidReason: resultRow.void_reason ?? null,
        tiebreakUsed: resultRow.tiebreak_used ?? null,
        settledVersion: resultRow.settled_version,
        lastSettleCause: resultRow.last_settle_cause,
      }
    : null;
  const lifecycle = resolveContestLifecycle(
    {
      status: contest.status,
      deadlineAt: contest.deadline_at,
      inputVersion: contest.input_version,
    },
    gameweek,
    fixtures.map((fixture) => ({
      state: fixture.state,
      status: fixture.status,
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
    })),
    result,
    now,
  );

  const boundaryById = new Map(gameweeks.map((row) => [row.id, row.number]));
  const leagueBoundary = participation.eligibleFromGameweekId
    ? boundaryById.get(participation.eligibleFromGameweekId) ?? null
    : null;
  const members = (memberCompetitionQuery.data ?? []) as any[];
  const eligibleRows = members.filter((member) =>
    isEligible(
      {
        leagueEligibleFromNumber: leagueBoundary,
        memberEligibleFromNumber: member.eligible_from_gameweek_id
          ? boundaryById.get(member.eligible_from_gameweek_id) ?? null
          : null,
        leftAt: member.left_at,
      },
      gameweek.number,
    ),
  );
  const viewerMember = members.find((member) => member.user_id === userId);
  const viewerMemberBoundary = viewerMember?.eligible_from_gameweek_id
    ? boundaryById.get(viewerMember.eligible_from_gameweek_id) ?? null
    : null;
  const viewerEligibleFromGameweekNumber =
    leagueBoundary != null && viewerMemberBoundary != null
      ? Math.max(leagueBoundary, viewerMemberBoundary)
      : null;
  const viewerEligible = viewerMember
    ? eligibleRows.some((member) => member.user_id === userId)
    : false;
  const viewerParticipation = resolveViewerParticipation({
    eligible: viewerEligible,
    entryStatus: viewerEntry?.status,
  });
  const render = resolveRender(lifecycle, viewerParticipation);
  const deadlineMs = new Date(contest.deadline_at).getTime();
  const nowMs = new Date(now).getTime();
  const shouldNudge =
    lifecycle === "CL1" &&
    (viewerParticipation === "VP1" || viewerParticipation === "VP3") &&
    deadlineMs > nowMs &&
    deadlineMs - nowMs <= 12 * 60 * 60 * 1000;
  const nudgeCopy = shouldNudge
    ? nudgeMessage({
        league: identity.league.name,
        gw: gameweek.number,
        deadline: formatIstDeadline(contest.deadline_at),
      })
    : null;

  const entries = (entriesQuery.data ?? []) as any[];
  const preDeadline = new Date(contest.deadline_at).getTime() > new Date(now).getTime();
  const entryNumbers = entryPotNumbers({
    entries: entries.map((entry) => ({ status: entry.status })),
    eligibleMembers: eligibleRows.length,
    stakeInr: contest.stake_inr,
    deadlinePassed: contest.status !== "open",
  });

  const terminal = ["locked", "settling", "settled", "void"].includes(contest.status);
  const snapshotQuery = terminal
    ? await supabase
        .from("gameweek_entry_results")
        .select(
          "entry_id, points, exacts, goal_error, net_inr, is_winner, gameweek_entries!gameweek_entry_results_entry_id_fkey!inner(user_id, status)",
        )
        .eq("gameweek_contest_id", contest.id)
    : { data: [], error: null };
  fail(snapshotQuery.error, "gameweek-entry-results");

  const revealQuery = preDeadline
    ? { data: [], error: null }
    : await supabase
        .from("gameweek_picks")
        .select(
          "fixture_id, pred_home, pred_away, gameweek_entries!gameweek_picks_entry_id_fkey!inner(user_id, gameweek_contest_id)",
        )
        .eq("gameweek_entries.gameweek_contest_id", contest.id);
  fail(revealQuery.error, "revealed-picks");

  const names = new Map<string, string>();
  for (const entry of entries) {
    const profile = one<any>(entry.profiles);
    if (profile) names.set(entry.user_id, profile.display_name ?? profile.username);
  }
  const snapshotDto = buildGameweekViewDTO({
    cl: lifecycle,
    snapshotEntryResults: (snapshotQuery.data ?? []) as any[],
  });
  const snapshotRows = (snapshotDto.entryResults ?? []) as any[];
  const derivedUserIds = new Set<string>(entries.map((entry) => entry.user_id));
  for (const row of snapshotRows) {
    const entry = one<any>(row.gameweek_entries);
    if (entry?.user_id) derivedUserIds.add(entry.user_id);
  }
  const missingNameIds = [...derivedUserIds].filter((id) => !names.has(id));
  if (missingNameIds.length && loadDepartedNames) {
    const departedQuery = await admin
      .from("profiles")
      .select("id, display_name, username")
      .in("id", missingNameIds);
    fail(departedQuery.error, "departed-member-names");
    for (const profile of departedQuery.data ?? []) {
      names.set(profile.id, profile.display_name ?? profile.username);
    }
  }

  let standings: GameweekStanding[] = [];
  if (lifecycle === "CL6" || lifecycle === "CL8" || lifecycle === "CL3" || lifecycle === "CL4") {
    const pickRows = (revealQuery.data ?? []) as any[];
    const picksByUser = new Map<
      string,
      { fixtureId: string; predHome: number; predAway: number }[]
    >();
    for (const pick of pickRows) {
      const entry = one<any>(pick.gameweek_entries);
      if (!entry?.user_id) continue;
      const current = picksByUser.get(entry.user_id) ?? [];
      current.push({
        fixtureId: pick.fixture_id,
        predHome: pick.pred_home,
        predAway: pick.pred_away,
      });
      picksByUser.set(entry.user_id, current);
    }
    const live = provisionalGameweek({
      entries: entries
        .filter((entry) => entry.status === "locked_in")
        .map((entry) => ({
          userId: entry.user_id,
          picks: picksByUser.get(entry.user_id) ?? [],
        })),
      fixtures: fixtures.map((fixture) => ({
        fixtureId: fixture.fixtureId,
        state: fixture.state,
        status: fixture.status,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
      })),
      stakeInr: contest.stake_inr,
    });
    if (live.state === "available") {
      standings = live.standings.map((standing) => ({
        userId: standing.userId,
        name: names.get(standing.userId) ?? "Player",
        points: standing.points,
        exacts: standing.exacts,
        goalError: standing.goalError,
        rank: standing.rank,
        status:
          entries.find((entry) => entry.user_id === standing.userId)?.status ??
          "locked_in",
        isViewer: standing.userId === userId,
      }));
    }
  } else if (lifecycle === "CL5") {
    const settledRows = snapshotRows
      .map((row) => {
        const entry = one<any>(row.gameweek_entries);
        return {
          userId: entry?.user_id ?? "",
          name: names.get(entry?.user_id) ?? "Player",
          points: row.points,
          exacts: row.exacts,
          goalError: row.goal_error,
          rank: null,
          netInr: row.net_inr,
          status: entry?.status ?? "locked_in",
          isViewer: entry?.user_id === userId,
        };
      })
      .sort(
        (a, b) =>
          (b.points ?? 0) - (a.points ?? 0) ||
          (b.exacts ?? 0) - (a.exacts ?? 0) ||
          (a.goalError ?? 0) - (b.goalError ?? 0),
      )
      .map((row, index) => ({ ...row, rank: index + 1 }));
    const settledIds = new Set(settledRows.map((row) => row.userId));
    const invalidRows = entries
      .filter(
        (entry) =>
          entry.status === "invalid" && !settledIds.has(entry.user_id),
      )
      .map((entry) => ({
        userId: entry.user_id,
        name: names.get(entry.user_id) ?? "Player",
        points: null,
        exacts: null,
        goalError: null,
        rank: null,
        status: "invalid",
        isViewer: entry.user_id === userId,
      }));
    standings = [...settledRows, ...invalidRows];
  }

  return {
    ...emptyBase,
    gameweek: {
      id: gameweek.id,
      number: gameweek.number,
      name: gameweek.name,
      status: gameweek.status,
      deadlineAt: gameweek.deadline_at,
    },
    contest: {
      id: contest.id,
      status: contest.status,
      stakeInr: contest.stake_inr,
      deadlineAt: contest.deadline_at,
      inputVersion: contest.input_version,
    },
    lifecycle,
    viewerParticipation,
    render,
    fixtures,
    viewerEntry,
    viewerPicks: (viewerPicksQuery.data ?? []).map((pick: any) => ({
      fixtureId: pick.fixture_id,
      predHome: pick.pred_home,
      predAway: pick.pred_away,
    })),
    revealedPicks: (revealQuery.data ?? []).map((pick: any) => ({
      userId: one<any>(pick.gameweek_entries)?.user_id ?? "",
      fixtureId: pick.fixture_id,
      predHome: pick.pred_home,
      predAway: pick.pred_away,
    })),
    standings,
    result,
    enteredCount: entryNumbers.entered,
    eligibleCount: entryNumbers.eligible,
    potInr: entryNumbers.potInr,
    isDoubleGameweek: fixtures.filter((fixture) => fixture.state === "active").length > 10,
    viewerEligibleFromGameweekNumber,
    nudge: nudgeCopy
      ? {
          href: `https://wa.me/?text=${encodeURIComponent(nudgeCopy)}`,
          copy: nudgeCopy,
        }
      : null,
  };
}

export async function loadMirrorTargets(
  supabase: CashfordClient,
  source: GameweekViewDTO,
  userId: string,
): Promise<MirrorTarget[]> {
  if (!source.gameweek || !source.contest || source.participation.status === "none") {
    return [];
  }
  const targetGameweekNumber = source.gameweek.number;
  const [participations, memberships, contests, entries] = await Promise.all([
    supabase
      .from("league_competitions")
      .select(
        "league_id, eligible_from_gameweek_id, status, leagues!inner(name)",
      )
      .eq("competition_id", source.competition.id)
      .eq("status", "active")
      .neq("league_id", source.league.id),
    supabase
      .from("member_competitions")
      .select("league_id, eligible_from_gameweek_id, left_at")
      .eq("competition_id", source.competition.id)
      .eq("user_id", userId),
    supabase
      .from("gameweek_contests")
      .select("id, league_id, stake_inr, deadline_at")
      .eq("gameweek_id", source.gameweek.id),
    supabase
      .from("gameweek_entries")
      .select("league_id")
      .eq("gameweek_id", source.gameweek.id)
      .eq("user_id", userId),
  ]);
  fail(participations.error, "mirror-leagues");
  fail(memberships.error, "mirror-memberships");
  fail(contests.error, "mirror-contests");
  fail(entries.error, "mirror-existing-entries");

  const memberByLeague = new Map(
    (memberships.data ?? []).map((row: any) => [row.league_id, row]),
  );
  const contestByLeague = new Map(
    (contests.data ?? []).map((row: any) => [row.league_id, row]),
  );
  const entered = new Set((entries.data ?? []).map((row: any) => row.league_id));
  const boundaryIds = [
    ...(participations.data ?? []).map((row: any) => row.eligible_from_gameweek_id),
    ...(memberships.data ?? []).map((row: any) => row.eligible_from_gameweek_id),
  ].filter((id): id is string => typeof id === "string");
  const boundaryQuery = boundaryIds.length
    ? await supabase
        .from("gameweeks")
        .select("id, number")
        .eq("competition_id", source.competition.id)
        .in("id", [...new Set(boundaryIds)])
    : { data: [], error: null };
  fail(boundaryQuery.error, "mirror-boundaries");
  const boundaryById = new Map(
    (boundaryQuery.data ?? []).map((row: any) => [row.id, row.number]),
  );
  const at = Date.now();

  return (participations.data ?? []).flatMap((row: any) => {
    const member = memberByLeague.get(row.league_id);
    const contest = contestByLeague.get(row.league_id);
    if (!member || !contest || entered.has(row.league_id)) return [];
    if (member.left_at != null || new Date(contest.deadline_at).getTime() <= at) return [];
    const leagueBoundary = row.eligible_from_gameweek_id;
    const memberBoundary = member.eligible_from_gameweek_id;
    if (
      !leagueBoundary ||
      !memberBoundary ||
      (boundaryById.get(leagueBoundary) ?? Number.POSITIVE_INFINITY) >
        targetGameweekNumber ||
      (boundaryById.get(memberBoundary) ?? Number.POSITIVE_INFINITY) >
        targetGameweekNumber
    ) {
      return [];
    }
    return [{
      leagueId: row.league_id,
      leagueName: one<any>(row.leagues)?.name ?? "",
      acceptedStakeInr: contest.stake_inr,
    }];
  });
}
