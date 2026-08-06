import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsView, Entry } from "./analytics";
import { buildWcFinalStandings } from "./wc-archive";
// Deliberately from "./wc-live-competition", not "./wc-archive-load" — the latter also exports
// loadKnockoutView/loadKnockoutLeaderboards, which transitively import "./knockout-data" (a
// server-only DB loader). gw-home.ts's pure helpers (e.g. homeCompetitionScopes) are imported by
// client components, so any top-level import here — static or dynamic — must not touch that
// chain, or Next's build fails with "You're importing a component that needs server-only".
import { loadLiveCompetition, resolveCurrentSeasonCompetition, resolveWcTransition } from "./wc-live-competition";
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
  type EntryStatusKey,
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
  allGameweekNumbers?: readonly number[];
  /** Item 1: the S9 "Adopt Premier League" bottom action is only real for a captain whose league
   * has a live league-format competition ready and not yet joined — computed via
   * resolveWcTransition() by the caller (transitionState() === "captain_adopt"), not guessed
   * here. Defaults to false so every other card keeps its current shape. */
  showAdopt?: boolean;
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
  competitionSlug: string | null;
  gameweekNumber: number | null;
  allGameweekNumbers: readonly number[];
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
  entryStatus: HomeEntryStatus | null;
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
    competitionSlug: input.competitionSlug ?? null,
    gameweekNumber: input.gameweekNumber,
    allGameweekNumbers: input.allGameweekNumbers ?? [],
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
    entryStatus: resolveHomeEntryStatus(input),
  };

  if (state === "S1" || state === "S6" || state === "S7") {
    // S6/S7 are compound "open + previous-GW fact" states resolved before viewer participation,
    // so an entered viewer lands here too. The open-GW action owns the primary block (locked
    // decision), and for a VP2 viewer that action is editing, not entering — otherwise the card
    // tells someone who already entered to "Enter GW4" while the hub row above says "Entered".
    const entered = input.viewerParticipation === "VP2";
    base.tone = "open";
    base.badge = entered ? LEAGUE_CARD_COPY.enteredBadge : LEAGUE_CARD_COPY.openBadge;
    base.primary = {
      kicker: LEAGUE_CARD_COPY.nextAction,
      title: entered
        ? LEAGUE_CARD_COPY.editGameweek(input.gameweekNumber ?? 0)
        : LEAGUE_CARD_COPY.enterGameweek(input.gameweekNumber ?? 0),
      deadlineAt: input.deadlineAt ?? undefined,
      deadlinePrefix: LEAGUE_CARD_COPY.closes,
      deadlineVariant: "time",
      deadlineIncludeWeekday: true,
      countdown: true,
      action: openAction(
        input,
        entered ? LEAGUE_CARD_COPY.editPredictions : LEAGUE_CARD_COPY.makePredictions,
      ),
    };
    if (entered) {
      base.rail.positionLabel = LEAGUE_CARD_COPY.seasonPosition;
    } else {
      base.rail.position = LEAGUE_CARD_COPY.missingValue;
      base.rail.positionTone = "muted";
      base.context = standardContext({ ...input, viewerRank: null });
    }
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
    base.bottomActions = input.showAdopt
      ? [
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
        ]
      : [
          {
            href: archiveHref,
            label: LEAGUE_CARD_COPY.openArchive,
            muted: false,
            arrow: "",
            tone: "green",
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

type ArchivedCardFacts = { memberCount: number; archiveRank: number | null; hasHistory: boolean };

/**
 * Perf: an archived competition's standings never change once the archive is closed out, but
 * every home render otherwise rebuilds them from three queries + buildWcFinalStandings. Cache
 * the result within a single request — a league appearing more than once in the same
 * loadHomeLeagueCards call (or a competition shared across leagues) skips the rebuild. Scoped to
 * the request (caller passes a fresh Map per call) rather than module-level: a module-level Map
 * persisted across requests/lambda instances with no eviction and gave non-deterministic results
 * across instances.
 */
export type ArchivedCardFactsCache = Map<string, ArchivedCardFacts>;

async function loadArchivedCardFactsCached(
  admin: CashfordClient,
  leagueId: string,
  competitionId: string,
  userId: string,
  cache: ArchivedCardFactsCache,
): Promise<ArchivedCardFacts> {
  const key = `${leagueId}:${competitionId}:${userId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const value = await loadArchivedCardFacts(admin, leagueId, competitionId, userId);
  cache.set(key, value);
  return value;
}

async function loadArchivedCardFacts(
  admin: CashfordClient,
  leagueId: string,
  competitionId: string,
  userId: string,
): Promise<ArchivedCardFacts> {
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
  const archivedCardFactsCache: ArchivedCardFactsCache = new Map();
  // Dual-review fix (R1 nit 5): the "which competition is current season" half of
  // loadLiveCompetition is league-independent — resolve it once per request instead of
  // re-querying it inside the per-league loop below.
  const currentSeasonCompetition = await resolveCurrentSeasonCompetition(admin);
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
          ? await loadArchivedCardFactsCached(admin, league.id, identity.participation.competitionId!, userId, archivedCardFactsCache)
          : null;
        // Item 1: gate the "Adopt Premier League" entry point on the real transition state
        // instead of showing it unconditionally on every archived cup league.
        const adoptGate = identity.participation.status === "archived"
          ? await loadLiveCompetition(admin, league.id, league.slug, currentSeasonCompetition)
          : null;
        const showAdopt = adoptGate
          ? resolveWcTransition(
              {
                pl: adoptGate.pl.data,
                participationStatus: adoptGate.participationStatus,
                otherActiveCompetition: adoptGate.otherActiveCompetition,
                leagueStatus: league.status,
              },
              identity.league.createdBy === userId,
            ) === "captain_adopt"
          : false;
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
          showAdopt,
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
        allGameweekNumbers: view.adjacentGameweeks.map((row) => row.number),
      });
    }),
  );
}

// ── Home hub: competition scope chips ───────────────────────────────────────────────

export type HomeCompetitionScope = {
  competitionSlug: string;
  competitionName: string;
  gameweekNumber: number | null;
};

/**
 * One scope per distinct competitionSlug across the viewer's active (non-archived, non-"none"
 * format) leagues, first-seen order. Archived leagues and leagues with no competition yet never
 * gate or get filtered by scope — they always show regardless of the selected chip.
 */
export function homeCompetitionScopes(
  cards: readonly Pick<HomeLeagueCard, "archived" | "format" | "competitionSlug" | "competitionName" | "gameweekNumber">[],
): HomeCompetitionScope[] {
  const seen = new Map<string, HomeCompetitionScope>();
  for (const card of cards) {
    if (card.archived) continue;
    if (card.format === "none") continue;
    if (!card.competitionSlug) continue;
    if (seen.has(card.competitionSlug)) continue;
    seen.set(card.competitionSlug, {
      competitionSlug: card.competitionSlug,
      competitionName: card.competitionName,
      gameweekNumber: card.gameweekNumber,
    });
  }
  return [...seen.values()];
}

/** Scope chips show only when the viewer's leagues span more than one competition. */
export function homeScopeChipsVisible(
  cards: readonly Pick<HomeLeagueCard, "archived" | "format" | "competitionSlug" | "competitionName" | "gameweekNumber">[],
): boolean {
  return homeCompetitionScopes(cards).length > 1;
}

/** Cards visible for a selected scope: archived and format:"none" cards always show; others filter by competitionSlug. */
export function homeCardsForScope<T extends Pick<HomeLeagueCard, "archived" | "format" | "competitionSlug">>(
  cards: readonly T[],
  scopeSlug: string | null,
): T[] {
  if (!scopeSlug) return [...cards];
  return cards.filter(
    (card) => card.archived || card.format === "none" || card.competitionSlug === scopeSlug,
  );
}

// ── Home hub: GW navigator (Option A · segmented strip, jump to any GW) ─────────────

export type GwNavigatorTarget = { gameweekNumber: number; isCurrent: boolean };

/** Every gameweek in the league is a reachable navigator target; the current one is flagged. */
export function gwNavigatorTargets(
  allGameweekNumbers: readonly number[],
  currentGameweekNumber: number | null,
): GwNavigatorTarget[] {
  return [...new Set(allGameweekNumbers)]
    .sort((a, b) => a - b)
    .map((gameweekNumber) => ({
      gameweekNumber,
      isCurrent: gameweekNumber === currentGameweekNumber,
    }));
}

// ── Home hub: entry-status copy A (eight-state canon) ───────────────────────────────

export type HomeEntryStatus =
  | { key: "notEnteredOpen"; deadlineAt: string | null }
  | { key: "enteredOpen"; deadlineAt: string | null }
  | { key: "submittedLocked"; deadlineAt: string | null }
  | { key: "live"; rank: number | null; total: number }
  | { key: "won"; rank: number; total: number; amountInr: number }
  | { key: "lost"; rank: number; total: number; amountInr: number }
  /** Not in the frame's eight-state canon — CL5 (settled) with a net of exactly zero. See
   * HOME_ENTRY_STATUS_COPY.brokeEven (lib/gw-copy.ts) for the copy convention judgment call. */
  | { key: "brokeEven"; rank: number; total: number }
  | { key: "void" }
  | { key: "syncIssue" };

/**
 * Maps a league card's already-resolved lifecycle/participation facts onto the eight canonical
 * entry-status states (lib/gw-copy.ts EntryStatusKey / HOME_ENTRY_STATUS_COPY). Returns null when
 * no entry-status row applies (archived cards, or no contest yet for the current gameweek).
 */
export function resolveHomeEntryStatus(
  input: Pick<
    HomeLeagueCardInput,
    | "lifecycle"
    | "viewerParticipation"
    | "viewerRank"
    | "eligibleCount"
    | "viewerNetInr"
    | "deadlineAt"
    | "liveMatchCount"
    | "archived"
  >,
): HomeEntryStatus | null {
  if (input.archived) return null;
  const lifecycle = input.lifecycle;
  if (lifecycle == null || lifecycle === "CL0") return null;

  if (lifecycle === "CL9" || lifecycle === "CL6" || lifecycle === "CL8") {
    return { key: "syncIssue" };
  }
  // CL10 = all of this gameweek's fixtures voided (lib/gw-state.ts resolveContestLifecycle);
  // consistent with the league screen's badge mapping (homeBadgeState), which treats CL7/CL10
  // identically as VOID. Must be checked before the CL2/CL3/CL4/CL10 locked-family branch below.
  if (lifecycle === "CL7" || lifecycle === "CL10") return { key: "void" };

  if (lifecycle === "CL1") {
    if (input.viewerParticipation === "VP1") {
      return { key: "notEnteredOpen", deadlineAt: input.deadlineAt };
    }
    if (
      input.viewerParticipation === "VP2" ||
      input.viewerParticipation === "VP3" ||
      input.viewerParticipation === "VP4"
    ) {
      return { key: "enteredOpen", deadlineAt: input.deadlineAt };
    }
    return null;
  }

  if (lifecycle === "CL2" || lifecycle === "CL3" || lifecycle === "CL4") {
    // Degrade gracefully rather than fall back to Locked: a live gameweek whose provisional
    // standing hasn't produced this viewer's rank yet still shows a live-state row, with the
    // rank segment itself degraded (HOME_ENTRY_STATUS_COPY.live handles rank === null).
    if ((input.liveMatchCount ?? 0) > 0 && input.eligibleCount) {
      return { key: "live", rank: input.viewerRank, total: input.eligibleCount };
    }
    return { key: "submittedLocked", deadlineAt: input.deadlineAt };
  }

  if (lifecycle === "CL5") {
    if (input.viewerRank == null || !input.eligibleCount || input.viewerNetInr == null) return null;
    if (input.viewerNetInr > 0) {
      return { key: "won", rank: input.viewerRank, total: input.eligibleCount, amountInr: input.viewerNetInr };
    }
    if (input.viewerNetInr < 0) {
      return { key: "lost", rank: input.viewerRank, total: input.eligibleCount, amountInr: input.viewerNetInr };
    }
    // net === 0: a settled contest where the viewer's stake exactly offset — not in the frame's
    // eight-state canon. See HOME_ENTRY_STATUS_COPY.brokeEven for the copy judgment call.
    return { key: "brokeEven", rank: input.viewerRank, total: input.eligibleCount };
  }

  return null;
}

export type { EntryStatusKey };
