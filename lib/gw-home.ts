import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsView, Entry } from "./analytics";
import { buildWcFinalStandings } from "./wc-archive";
import {
  C6,
  C10,
  C14,
  C26,
  C29,
  C9,
  C45,
  C46,
  C47,
  C48,
  C49,
  C58,
  C59,
  C60,
  C64,
  C65,
  C66,
  C72,
  LEAGUE_CARD_COPY,
  moneyCopy,
} from "./gw-copy";
import {
  homeBadgeState,
  type ContestLifecycle,
  type ViewerParticipation,
} from "./gw-state";
import { leagueNetByUser } from "./gameweek-db";
import {
  loadGameweekView,
  loadLeagueIdentity,
  type GameweekViewDTO,
  type HomeGameweekFact,
} from "./gw-view";

type CashfordClient = SupabaseClient<any, "cashford", any>;

export type HomeLeagueCardState =
  | "S1"
  | "S2"
  | "S3"
  | "S4"
  | "S5"
  | "S6"
  | "S7"
  | "S9"
  | "S10";

export type HomeLeagueCardResolvedState = HomeLeagueCardState | "OTHER";
export type HomeLeagueCardTone =
  | "open"
  | "live"
  | "settled"
  | "loss"
  | "archive"
  | "upcoming"
  | "neutral";

export type HomeLeagueCardSecondaryFact = {
  gameweekNumber: number;
  kind: HomeGameweekFact["kind"];
  viewerRank: number | null;
  viewerNetInr: number | null;
  liveMatchCount: number;
};

export type HomeLeagueCardInput = {
  leagueId: string;
  leagueName: string;
  slug: string;
  competitionName: string;
  competitionSlug?: string | null;
  format: "cup" | "gameweek" | "none";
  archived: boolean;
  lifecycle: ContestLifecycle | null;
  viewerParticipation: ViewerParticipation | null;
  gameweekNumber: number | null;
  deadlineAt: string | null;
  upcomingAt: string | null;
  potInr: number;
  enteredCount: number;
  eligibleCount: number;
  viewerRank: number | null;
  viewerNetInr: number | null;
  secondary: readonly HomeLeagueCardSecondaryFact[];
  pendingPaymentCount: number;
  netInr: number | "suppressed";
  hasSettledHistory: boolean;
  memberCount?: number | null;
  archiveRank?: number | null;
  liveMatchCount?: number;
  finalMatchCount?: number;
  totalMatchCount?: number;
}

type HomeLeagueCardActionTone = "green" | "amber";

type HomeLeagueCardAction = {
  href: string | null;
  label: string;
  muted: boolean;
  arrow: string;
  tone: HomeLeagueCardActionTone;
};

export type HomeLeagueCardDetail = {
  prefix: string;
  amount: string;
  suffix: string;
};

export type HomeLeagueCard = {
  leagueId: string;
  leagueName: string;
  slug: string;
  competitionName: string;
  format: HomeLeagueCardInput["format"];
  archived: boolean;
  state: HomeLeagueCardResolvedState;
  tone: HomeLeagueCardTone;
  badge: string;
  primary: {
    kicker: string;
    title: string;
    detail?: string | HomeLeagueCardDetail;
    deadlineAt?: string;
    deadlinePrefix?: string;
    deadlineVariant?: "time" | "date";
    deadlineIncludeWeekday?: boolean;
    deadlineSuffix?: string;
    countdown: boolean;
    action?: HomeLeagueCardAction;
  };
  rail: {
    net: string;
    netTone: "positive" | "negative" | "muted" | "neutral";
    positionLabel: string;
    position: string;
    positionTone: "muted" | "normal";
  };
  context: readonly string[];
  secondary?: {
    tag: string;
    copy: string;
    rank: string;
    live: boolean;
  };
  duesLabel?: string;
  bottomActions?: readonly HomeLeagueCardAction[];
  netInr: number | "suppressed";
  hasSettledHistory: boolean;
  pendingPaymentCount: number;
};

export function resolveHomeLeagueCardState(
  input: Pick<
    HomeLeagueCardInput,
    | "format"
    | "archived"
    | "lifecycle"
    | "viewerParticipation"
    | "viewerNetInr"
    | "secondary"
    | "pendingPaymentCount"
    | "liveMatchCount"
  >,
): HomeLeagueCardResolvedState {
  if (input.archived) return "S9";
  if (input.lifecycle === "CL0") return "S10";

  if (input.lifecycle === "CL1") {
    const latest = latestSecondary(input.secondary);
    if (latest?.kind === "live" && latest.liveMatchCount > 0) return "S7";
    if (latest?.kind === "settled") return "S6";
    if (input.viewerParticipation === "VP1") return "S1";
    if (input.viewerParticipation === "VP2") return "S2";
    return "OTHER";
  }

  if (input.lifecycle === "CL3" && (input.liveMatchCount ?? 0) > 0) return "S3";
  if (input.lifecycle === "CL5") {
    if (input.viewerNetInr != null && input.viewerNetInr > 0) return "S4";
    if (input.viewerNetInr != null && input.viewerNetInr < 0) return "S5";
  }
  return "OTHER";
}

function latestSecondary(
  facts: readonly HomeLeagueCardSecondaryFact[],
): HomeLeagueCardSecondaryFact | null {
  return [...facts].sort((a, b) => b.gameweekNumber - a.gameweekNumber)[0] ?? null;
}

function netTone(value: number | "suppressed"): HomeLeagueCard["rail"]["netTone"] {
  if (value === "suppressed") return "muted";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function viewerPosition(rank: number | null): string {
  return rank == null ? LEAGUE_CARD_COPY.missingValue : LEAGUE_CARD_COPY.rank(rank);
}

function standardContext(input: HomeLeagueCardInput): string[] {
  return [
    LEAGUE_CARD_COPY.pot(input.potInr),
    LEAGUE_CARD_COPY.enteredCount(input.enteredCount, input.eligibleCount),
    LEAGUE_CARD_COPY.viewer(input.viewerRank),
  ];
}

function secondaryPresentation(
  fact: HomeLeagueCardSecondaryFact | null,
): HomeLeagueCard["secondary"] {
  if (!fact) return undefined;
  if (fact.kind === "live") {
    if (fact.liveMatchCount <= 0) return undefined;
    return {
      tag: LEAGUE_CARD_COPY.gameweekTag(fact.gameweekNumber),
      copy: LEAGUE_CARD_COPY.liveGameweek(fact.liveMatchCount),
      rank: LEAGUE_CARD_COPY.liveRank(fact.viewerRank),
      live: true,
    };
  }
  const net = fact.viewerNetInr;
  const copy = net == null
    ? C66
    : net > 0
      ? LEAGUE_CARD_COPY.settledSecondaryWon(net)
      : net < 0
        ? LEAGUE_CARD_COPY.settledSecondaryLost(net)
        : LEAGUE_CARD_COPY.settledSecondaryBreakEven;
  return {
    tag: LEAGUE_CARD_COPY.gameweekTag(fact.gameweekNumber),
    copy,
    rank: viewerPosition(fact.viewerRank),
    live: false,
  };
}

function openAction(input: HomeLeagueCardInput, label: string): HomeLeagueCardAction {
  return {
    href: input.gameweekNumber == null
      ? null
      : `/leagues/${input.slug}/enter?gw=${input.gameweekNumber}`,
    label,
    muted: false,
    arrow: LEAGUE_CARD_COPY.arrow,
    tone: "green",
  };
}

function liveAction(input: HomeLeagueCardInput): HomeLeagueCardAction {
  return {
    href: input.gameweekNumber == null
      ? null
      : `/leagues/${input.slug}?gw=${input.gameweekNumber}#league-gw-${input.gameweekNumber}-matches`,
    label: LEAGUE_CARD_COPY.viewLivePoints,
    muted: false,
    arrow: LEAGUE_CARD_COPY.arrow,
    tone: "green",
  };
}

function settledAction(input: HomeLeagueCardInput): HomeLeagueCardAction {
  return {
    href: input.gameweekNumber == null
      ? null
      : `/leagues/${input.slug}?gw=${input.gameweekNumber}#league-gw-${input.gameweekNumber}-matches`,
    label: input.gameweekNumber == null
      ? LEAGUE_CARD_COPY.seeResult(0)
      : LEAGUE_CARD_COPY.seeResult(input.gameweekNumber),
    muted: false,
    arrow: LEAGUE_CARD_COPY.arrow,
    tone: "green",
  };
}

export function buildHomeLeagueCard(input: HomeLeagueCardInput): HomeLeagueCard {
  const state = resolveHomeLeagueCardState(input);
  const net = input.netInr === "suppressed" ? C60 : moneyCopy(input.netInr);
  const base: HomeLeagueCard = {
    leagueId: input.leagueId,
    leagueName: input.leagueName,
    slug: input.slug,
    competitionName: input.competitionName,
    format: input.format,
    archived: input.archived,
    state,
    tone: "neutral" as HomeLeagueCardTone,
    badge: "",
    primary: {
      kicker: LEAGUE_CARD_COPY.gameweekStatus,
      title: input.gameweekNumber == null
        ? C29
        : LEAGUE_CARD_COPY.gameweekTitle(input.gameweekNumber),
      countdown: false,
    },
    rail: {
      net,
      netTone: netTone(input.netInr),
      positionLabel: LEAGUE_CARD_COPY.position,
      position: viewerPosition(input.viewerRank),
      positionTone: input.viewerRank == null ? "muted" as const : "normal" as const,
    },
    context: standardContext(input),
    netInr: input.netInr,
    hasSettledHistory: input.hasSettledHistory,
    pendingPaymentCount: input.pendingPaymentCount,
  };

  if (state === "S1" || state === "S6" || state === "S7") {
    base.tone = "open";
    base.badge = LEAGUE_CARD_COPY.openBadge;
    base.primary = {
      kicker: LEAGUE_CARD_COPY.nextAction,
      title: LEAGUE_CARD_COPY.enterGameweek(input.gameweekNumber ?? 0),
      deadlineAt: input.deadlineAt ?? undefined,
      deadlinePrefix: LEAGUE_CARD_COPY.closes,
      deadlineVariant: "time",
      deadlineIncludeWeekday: true,
      countdown: true,
      action: openAction(input, LEAGUE_CARD_COPY.makePredictions),
    };
    base.rail.position = LEAGUE_CARD_COPY.missingValue;
    base.rail.positionTone = "muted";
    base.context = standardContext({ ...input, viewerRank: null });
    if (state === "S6" || state === "S7") {
      base.secondary = secondaryPresentation(latestSecondary(input.secondary));
    }
  } else if (state === "S2") {
    base.tone = "open";
    base.badge = LEAGUE_CARD_COPY.enteredBadge;
    base.rail.positionLabel = LEAGUE_CARD_COPY.seasonPosition;
    base.primary = {
      kicker: LEAGUE_CARD_COPY.nextAction,
      title: LEAGUE_CARD_COPY.editGameweek(input.gameweekNumber ?? 0),
      deadlineAt: input.deadlineAt ?? undefined,
      deadlinePrefix: LEAGUE_CARD_COPY.closes,
      deadlineVariant: "time",
      deadlineIncludeWeekday: true,
      countdown: true,
      action: openAction(input, LEAGUE_CARD_COPY.editPredictions),
    };
  } else if (state === "S3") {
    if ((input.liveMatchCount ?? 0) > 0) {
      base.tone = "live";
      base.badge = LEAGUE_CARD_COPY.liveBadge;
      base.rail.positionLabel = LEAGUE_CARD_COPY.gameweekPosition;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekStatus,
        title: LEAGUE_CARD_COPY.liveGameweek(input.liveMatchCount ?? 0),
        detail: LEAGUE_CARD_COPY.pointsUpdate,
        countdown: false,
        action: liveAction(input),
      };
    } else {
      base.tone = "neutral";
      base.badge = LEAGUE_CARD_COPY.lockedBadge;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekStatus,
        title: C10(input.gameweekNumber ?? 0),
        detail: C58(input.gameweekNumber ?? 0),
        countdown: false,
      };
    }
  } else if (state === "S4" || state === "S5") {
    const won = state === "S4";
    base.tone = won ? "settled" : "loss";
    base.badge = LEAGUE_CARD_COPY.settledBadge;
    base.rail.positionLabel = LEAGUE_CARD_COPY.gameweekPosition;
    base.primary = {
      kicker: LEAGUE_CARD_COPY.gameweekResult,
      title: LEAGUE_CARD_COPY.settledGameweek(input.gameweekNumber ?? 0),
      detail: won
        ? LEAGUE_CARD_COPY.wonDetail(input.viewerNetInr as number)
        : LEAGUE_CARD_COPY.lostDetail(input.viewerNetInr as number),
      countdown: false,
      action: settledAction(input),
    };
  } else if (state === "S9") {
    const archiveHref = `/leagues/${input.slug}/archive/${input.competitionSlug ?? "wc2026"}`;
    const adoptHref = `${archiveHref}#adopt-premier-league`;
    base.tone = "archive";
    base.badge = LEAGUE_CARD_COPY.archivedBadge;
    base.competitionName = LEAGUE_CARD_COPY.archivedCompetition(input.competitionName);
    base.primary = {
      kicker: LEAGUE_CARD_COPY.archive,
      title: LEAGUE_CARD_COPY.openArchive,
      detail: LEAGUE_CARD_COPY.archivedDetail,
      countdown: false,
      action: {
        href: archiveHref,
        label: LEAGUE_CARD_COPY.viewWorldCupArchive,
        muted: true,
        arrow: LEAGUE_CARD_COPY.arrow,
        tone: "amber",
      },
    };
    base.rail.positionLabel = LEAGUE_CARD_COPY.finalRank;
    base.rail.position = viewerPosition(input.archiveRank ?? null);
    base.rail.positionTone = input.archiveRank == null ? "muted" : "normal";
    base.context = [
      LEAGUE_CARD_COPY.noLivePot,
      LEAGUE_CARD_COPY.memberCount(input.memberCount ?? 0),
      LEAGUE_CARD_COPY.readOnly,
    ];
    base.bottomActions = [
      {
        href: archiveHref,
        label: LEAGUE_CARD_COPY.openArchive,
        muted: false,
        arrow: "",
        tone: "green",
      },
      {
        href: adoptHref,
        label: LEAGUE_CARD_COPY.adoptPremierLeague,
        muted: false,
        arrow: "",
        tone: "amber",
      },
    ];
  } else if (state === "S10") {
    base.tone = "upcoming";
    base.badge = LEAGUE_CARD_COPY.upcomingBadge;
    base.primary = {
      kicker: LEAGUE_CARD_COPY.competitionStatus,
      title: LEAGUE_CARD_COPY.firstGameweekUpcoming,
      detail: input.upcomingAt ? undefined : LEAGUE_CARD_COPY.entriesOpenFriday,
      deadlineAt: input.upcomingAt ?? undefined,
      deadlineVariant: "date",
      deadlineSuffix: LEAGUE_CARD_COPY.entriesOpenFriday,
      countdown: false,
      action: {
        href: null,
        label: LEAGUE_CARD_COPY.waitingForGameweek(1),
        muted: true,
        arrow: LEAGUE_CARD_COPY.mutedArrow,
        tone: "amber",
      },
    };
    base.rail.position = LEAGUE_CARD_COPY.missingValue;
    base.rail.positionTone = "muted";
  } else {
    const number = input.gameweekNumber ?? 0;
    if (input.lifecycle === "CL1" && input.viewerParticipation === "VP3") {
      base.tone = "open";
      base.badge = LEAGUE_CARD_COPY.actionNeededBadge;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.nextAction,
        title: C45(number),
        detail: C46,
        deadlineAt: input.deadlineAt ?? undefined,
        deadlinePrefix: LEAGUE_CARD_COPY.closes,
        deadlineVariant: "time",
        deadlineIncludeWeekday: true,
        countdown: true,
        action: openAction(input, C47),
      };
    } else if (input.lifecycle === "CL1" && input.viewerParticipation === "VP5") {
      base.tone = "loss";
      base.badge = LEAGUE_CARD_COPY.actionNeededBadge;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekStatus,
        title: C48(number),
        detail: C49,
        countdown: false,
      };
      base.rail.position = LEAGUE_CARD_COPY.missingValue;
      base.rail.positionTone = "muted";
      base.context = standardContext({ ...input, viewerRank: null });
    } else if (input.lifecycle === "CL1" && input.viewerParticipation === "VP0") {
      base.tone = "neutral";
      base.badge = LEAGUE_CARD_COPY.openBadge;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekStatus,
        title: C65(number),
        countdown: false,
      };
      base.rail.position = LEAGUE_CARD_COPY.missingValue;
      base.rail.positionTone = "muted";
      base.context = standardContext({ ...input, viewerRank: null });
    } else if (input.lifecycle === "CL1") {
      base.tone = "open";
      base.badge = LEAGUE_CARD_COPY.enteredBadge;
      base.rail.positionLabel = LEAGUE_CARD_COPY.seasonPosition;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekStatus,
        title: C6(number),
        detail: C9,
        countdown: false,
      };
    } else if (
      input.lifecycle === "CL2" ||
      (input.lifecycle === "CL3" && (input.liveMatchCount ?? 0) <= 0)
    ) {
      base.tone = "neutral";
      base.badge = LEAGUE_CARD_COPY.lockedBadge;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekStatus,
        title: C10(number),
        detail: C58(number),
        countdown: false,
      };
    } else if (input.lifecycle === "CL4") {
      base.tone = "neutral";
      base.badge = LEAGUE_CARD_COPY.lockedBadge;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekStatus,
        title: C59,
        detail:
          input.finalMatchCount != null && input.totalMatchCount != null
            ? C14(input.finalMatchCount, input.totalMatchCount)
            : undefined,
        countdown: false,
      };
    } else if (input.lifecycle === "CL5") {
      const viewerNet = input.viewerNetInr;
      base.tone = viewerNet != null && viewerNet < 0 ? "loss" : "settled";
      base.badge = LEAGUE_CARD_COPY.settledBadge;
      base.rail.positionLabel = LEAGUE_CARD_COPY.gameweekPosition;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekResult,
        title: LEAGUE_CARD_COPY.settledGameweek(number),
        detail: input.viewerParticipation === "VP5"
          ? C49
          : viewerNet == null
            ? C66
            : viewerNet === 0
              ? LEAGUE_CARD_COPY.breakEvenDetail
              : viewerNet > 0
                ? LEAGUE_CARD_COPY.wonDetail(viewerNet)
                : LEAGUE_CARD_COPY.lostDetail(viewerNet),
        countdown: false,
        action: settledAction(input),
      };
    } else if (input.lifecycle === "CL7") {
      base.tone = "neutral";
      base.badge = LEAGUE_CARD_COPY.voidBadge;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekStatus,
        title: C26(number),
        countdown: false,
      };
    } else if (input.lifecycle === "CL10") {
      base.tone = "neutral";
      base.badge = LEAGUE_CARD_COPY.voidBadge;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekStatus,
        title: C72,
        countdown: false,
      };
    } else {
      base.tone = input.archived ? "archive" : "neutral";
      base.badge = input.archived
        ? LEAGUE_CARD_COPY.archivedBadge
        : input.lifecycle
          ? homeBadgeState(input.lifecycle, input.viewerParticipation ?? "VP0")
          : LEAGUE_CARD_COPY.upcomingBadge;
      base.primary = {
        kicker: LEAGUE_CARD_COPY.gameweekStatus,
        title: input.gameweekNumber == null
          ? C29
          : LEAGUE_CARD_COPY.gameweekTitle(input.gameweekNumber),
        detail: input.lifecycle === "CL6" || input.lifecycle === "CL8"
          ? C60
          : input.lifecycle === "CL9"
            ? C64
            : C29,
        countdown: false,
      };
    }
  }

  if (input.pendingPaymentCount > 0) {
    base.duesLabel = LEAGUE_CARD_COPY.duesChip(input.pendingPaymentCount);
  }

  return base;
}

export function analyticsVisibleForHomeCards(
  cards: readonly Pick<HomeLeagueCard, "hasSettledHistory">[],
): boolean {
  return cards.some((card) => card.hasSettledHistory);
}

export function analyticsViewHasHistory(
  view: Pick<AnalyticsView, "global">,
): boolean {
  return view.global.pot.entered > 0;
}

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function loadArchivedCardFacts(
  admin: CashfordClient,
  leagueId: string,
  competitionId: string,
  userId: string,
): Promise<{ memberCount: number; archiveRank: number | null; hasHistory: boolean }> {
  const [membersQuery, resultsQuery, predictionsQuery] = await Promise.all([
    admin.from("league_members").select("user_id").eq("league_id", leagueId),
    admin
      .from("contest_results")
      .select("user_id, net_inr, contests!inner(id, league_id, fixtures!inner(competition_id, kickoff_at, ft_home, ft_away, is_knockout, advancer_team_id))")
      .eq("contests.league_id", leagueId)
      .eq("contests.fixtures.competition_id", competitionId),
    admin
      .from("predictions")
      .select("user_id, outcome, pred_home, pred_away, contests!inner(id, league_id, fixtures!inner(id, kickoff_at, home_label, away_label, ft_home, ft_away, is_knockout, advancer_team_id, competition_id))")
      .eq("contests.league_id", leagueId)
      .eq("contests.fixtures.competition_id", competitionId),
  ]);
  fail(membersQuery.error, "home-archive-members");
  fail(resultsQuery.error, "home-archive-results");
  fail(predictionsQuery.error, "home-archive-predictions");

  const memberIds = (membersQuery.data ?? []).map((row: any) => row.user_id as string);
  const netByUser = new Map<string, number>();
  const resultByKey = new Map<string, number>();
  for (const row of resultsQuery.data ?? []) {
    const contest = one<any>(row.contests);
    const net = Number(row.net_inr ?? 0);
    netByUser.set(row.user_id, (netByUser.get(row.user_id) ?? 0) + net);
    if (contest?.id) resultByKey.set(`${contest.id}:${row.user_id}`, net);
  }
  const entriesByUser = new Map<string, Entry[]>();
  const unavailableUserIds = new Set<string>();
  for (const row of predictionsQuery.data ?? []) {
    const contest = one<any>(row.contests);
    const fixture = one<any>(contest?.fixtures);
    if (!fixture || fixture.ft_home == null || fixture.ft_away == null) {
      unavailableUserIds.add(row.user_id);
      continue;
    }
    const entries = entriesByUser.get(row.user_id) ?? [];
    entries.push({
      outcome: row.outcome,
      predHome: row.pred_home,
      predAway: row.pred_away,
      ftHome: fixture.ft_home,
      ftAway: fixture.ft_away,
      isKnockout: fixture.is_knockout,
      advancer: null,
      net: contest?.id ? resultByKey.get(`${contest.id}:${row.user_id}`) ?? null : null,
      kickoffMs: new Date(fixture.kickoff_at).getTime(),
      dayKey: "",
      homeLabel: fixture.home_label ?? "Home",
      awayLabel: fixture.away_label ?? "Away",
    });
    entriesByUser.set(row.user_id, entries);
  }
  const standings = buildWcFinalStandings({
    members: memberIds.map((userId) => ({ userId, name: userId })),
    entriesByUser,
    netByUser,
    unavailableUserIds: [...unavailableUserIds],
  });
  return {
    memberCount: memberIds.length,
    archiveRank: standings.find((row) => row.userId === userId)?.finish ?? null,
    hasHistory: (resultsQuery.data?.length ?? 0) > 0,
  };
}

function secondaryFactsFromView(view: GameweekViewDTO): HomeLeagueCardSecondaryFact[] {
  if (!view.gameweek) return [];
  return view.adjacentGameweeks
    .filter((row) => row.number < view.gameweek!.number && row.homeFact)
    .map((row) => ({
      gameweekNumber: row.number,
      kind: row.homeFact!.kind,
      viewerRank: row.homeFact!.viewerRank,
      viewerNetInr: row.homeFact!.viewerNetInr,
      liveMatchCount: row.homeFact!.liveMatchCount,
    }));
}

function upcomingAtFromView(view: GameweekViewDTO): string | null {
  return view.adjacentGameweeks.find(
    (row) => !row.hasContest && row.status === "upcoming" && row.deadlineAt,
  )?.deadlineAt ?? null;
}

export async function loadHomeLeagueCards(
  supabase: CashfordClient,
  admin: CashfordClient,
  leagues: readonly { id: string; name: string; slug: string; status: string }[],
  userId: string,
): Promise<HomeLeagueCard[]> {
  return Promise.all(
    leagues.map(async (league) => {
      const [identity, leagueNet] = await Promise.all([
        loadLeagueIdentity(supabase, league.slug),
        leagueNetByUser(supabase, league.id, [userId]),
      ]);
      const pendingQuery = await admin
        .from("payments")
        .select("id, payer_user_id, receiver_user_id, required_payer_confirmation, required_receiver_confirmation, status")
        .eq("league_id", league.id)
        .in("status", ["pending", "disputed"]);
      fail(pendingQuery.error, "home-pending-payments");
      const pendingPaymentCount = (pendingQuery.data ?? []).filter((payment: any) =>
        (payment.payer_user_id === userId && payment.required_payer_confirmation) ||
        (payment.receiver_user_id === userId && payment.required_receiver_confirmation),
      ).length;
      const netInr = leagueNet === "suppressed" ? "suppressed" : leagueNet[userId] ?? 0;

      if (!identity || identity.participation.status === "none") {
        return buildHomeLeagueCard({
          leagueId: league.id,
          leagueName: league.name,
          slug: league.slug,
          competitionName: "",
          format: "none",
          archived: league.status === "archived",
          lifecycle: null,
          viewerParticipation: null,
          gameweekNumber: null,
          deadlineAt: null,
          upcomingAt: null,
          potInr: 0,
          enteredCount: 0,
          eligibleCount: 0,
          viewerRank: null,
          viewerNetInr: null,
          secondary: [],
          pendingPaymentCount,
          netInr,
          hasSettledHistory: false,
        });
      }

      if (identity.participation.format === "cup") {
        const archiveFacts = identity.participation.status === "archived"
          ? await loadArchivedCardFacts(admin, league.id, identity.participation.competitionId!, userId)
          : null;
        return buildHomeLeagueCard({
          leagueId: league.id,
          leagueName: league.name,
          slug: league.slug,
          competitionName: identity.participation.competitionName ?? "",
          competitionSlug: identity.participation.competitionSlug,
          format: "cup",
          archived: identity.participation.status === "archived",
          lifecycle: null,
          viewerParticipation: identity.participation.status === "archived" ? "VP0" : "VP1",
          gameweekNumber: null,
          deadlineAt: null,
          upcomingAt: null,
          potInr: 0,
          enteredCount: 0,
          eligibleCount: archiveFacts?.memberCount ?? 0,
          viewerRank: null,
          viewerNetInr: null,
          secondary: [],
          pendingPaymentCount,
          netInr,
          hasSettledHistory: archiveFacts?.hasHistory ?? false,
          memberCount: archiveFacts?.memberCount ?? null,
          archiveRank: archiveFacts?.archiveRank ?? null,
        });
      }

      const view = await loadGameweekView(
        supabase,
        admin,
        identity,
        userId,
        undefined,
        new Date(),
        false,
      );
      const currentStanding = view.standings.find((standing) => standing.isViewer) ?? null;
      const gameweekNumber = view.gameweek?.number ?? null;
      const activeFixtures = view.fixtures.filter((fixture) => fixture.state === "active");
      return buildHomeLeagueCard({
        leagueId: league.id,
        leagueName: league.name,
        slug: league.slug,
        competitionName: identity.participation.competitionName ?? "",
        competitionSlug: identity.participation.competitionSlug,
        format: "gameweek",
        archived: identity.participation.status === "archived",
        lifecycle: view.lifecycle,
        viewerParticipation: view.viewerParticipation,
        gameweekNumber,
        deadlineAt: view.contest?.deadlineAt ?? null,
        upcomingAt: view.lifecycle === "CL0" ? upcomingAtFromView(view) : null,
        potInr: view.potInr,
        enteredCount: view.enteredCount,
        eligibleCount: view.eligibleCount,
        viewerRank: currentStanding?.rank ?? view.viewerSeasonRank ?? null,
        viewerNetInr: currentStanding?.netInr ?? null,
        secondary: secondaryFactsFromView(view),
        pendingPaymentCount,
        netInr,
        hasSettledHistory: view.hasSettledHistory,
        liveMatchCount: activeFixtures.filter((fixture) => fixture.status === "live").length,
        finalMatchCount: activeFixtures.filter((fixture) => fixture.status === "finished").length,
        totalMatchCount: activeFixtures.length,
      });
    }),
  );
}
