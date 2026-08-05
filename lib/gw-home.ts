import type { SupabaseClient } from "@supabase/supabase-js";
import {
  C1,
  C5,
  C10,
  C12,
  C16,
  C26,
  C29,
  C30Prefix,
  C60,
  C68,
} from "./gw-copy";
import type { AnalyticsView } from "./analytics";
import { homeBadgeState } from "./gw-state";
import { leagueNetByUser } from "./gameweek-db";
import {
  loadGameweekView,
  loadLeagueIdentity,
} from "./gw-view";

type CashfordClient = SupabaseClient<any, "cashford", any>;

export type HomeLeagueCard = {
  leagueId: string;
  leagueName: string;
  slug: string;
  competitionName: string;
  format: "cup" | "gameweek" | "none";
  archived: boolean;
  badge?: string;
  subline: string;
  openDetails?: {
    gameweekNumber: number;
    deadlineAt: string;
    potInr: number;
    enteredCount: number;
    eligibleCount: number;
  };
  gameweekStarted: boolean;
  hasSettledHistory: boolean;
  netInr: number | "suppressed";
  action?: { href: string; label: string };
  pendingPaymentCount: number;
};

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
      const pendingQuery = await admin.from("payments").select("id, payer_user_id, receiver_user_id, required_payer_confirmation, required_receiver_confirmation, status").eq("league_id", league.id).in("status", ["pending", "disputed"]);
      const pendingPaymentCount = (pendingQuery.data ?? []).filter((payment: any) =>
        (payment.payer_user_id === userId && payment.required_payer_confirmation) ||
        (payment.receiver_user_id === userId && payment.required_receiver_confirmation),
      ).length;
      const netInr =
        leagueNet === "suppressed" ? "suppressed" : leagueNet[userId] ?? 0;
      if (!identity || identity.participation.status === "none") {
        return {
          leagueId: league.id,
          leagueName: league.name,
          slug: league.slug,
          competitionName: "",
          format: "none" as const,
          archived: league.status === "archived",
          subline: C29,
          gameweekStarted: false,
          hasSettledHistory: false,
          netInr,
          pendingPaymentCount,
        };
      }
      if (identity.participation.format === "cup") {
        return {
          leagueId: league.id,
          leagueName: league.name,
          slug: league.slug,
          competitionName: identity.participation.competitionName ?? "",
          format: "cup" as const,
          archived: identity.participation.status === "archived",
          subline: identity.participation.competitionName ?? "",
          gameweekStarted: false,
          hasSettledHistory: false,
          netInr,
          pendingPaymentCount,
        };
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
      let subline = C29;
      let openDetails: HomeLeagueCard["openDetails"];
      if (view.gameweek && view.lifecycle === "CL1") {
        subline = C1(view.gameweek.number);
      }
      if (view.gameweek && view.contest) {
        if (view.lifecycle === "CL1") {
          openDetails = {
            gameweekNumber: view.gameweek.number,
            deadlineAt: view.contest.deadlineAt,
            potInr: view.potInr,
            enteredCount: view.enteredCount,
            eligibleCount: view.eligibleCount,
          };
        } else if (view.lifecycle === "CL2") {
          subline = C10(view.gameweek.number);
        } else if (view.lifecycle === "CL3" || view.lifecycle === "CL4") {
          subline = C12(view.gameweek.number);
        } else if (view.lifecycle === "CL5") {
          subline = C16(view.gameweek.number);
        } else if (view.lifecycle === "CL7" || view.lifecycle === "CL10") {
          subline = C26(view.gameweek.number);
        } else if (view.lifecycle === "CL6" || view.lifecycle === "CL8") {
          subline = C60;
        }
      }
      const needsEntry =
        view.lifecycle === "CL1" &&
        (view.viewerParticipation === "VP1" ||
          view.viewerParticipation === "VP3") &&
        view.gameweek &&
        view.contest;
      return {
        leagueId: league.id,
        leagueName: league.name,
        slug: league.slug,
        competitionName: identity.participation.competitionName ?? "",
        format: "gameweek" as const,
        archived: identity.participation.status === "archived",
        badge: homeBadgeState(view.lifecycle, view.viewerParticipation),
        subline,
        openDetails,
        gameweekStarted:
          view.gameweek != null && view.gameweek.status !== "upcoming",
        hasSettledHistory: view.hasSettledHistory,
        netInr,
        pendingPaymentCount,
        action: needsEntry
          ? {
              href: `/leagues/${league.slug}/enter?gw=${view.gameweek!.number}`,
              label: C68(view.contest!.stakeInr, league.name),
            }
          : undefined,
      };
    }),
  );
}
