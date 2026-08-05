import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAnalyticsView } from "./home-analytics";
import {
  analyticsViewHasHistory,
  analyticsVisibleForHomeCards,
  loadHomeLeagueCards,
  type HomeLeagueCard,
} from "./gw-home";
import type { AnalyticsView } from "./analytics";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

export type HomePageLoad = {
  leagues: { id: string; name: string; slug: string; status: string }[];
  analyticsView: AnalyticsView;
  homeLeagueCards: HomeLeagueCard[];
  analyticsVisible: boolean;
};

/** The server-side read path used by app/page.tsx. */
export async function loadHomePage(
  supabase: CashfordClient,
  admin: CashfordClient,
  userId: string,
): Promise<HomePageLoad> {
  const [leaguesQuery, analyticsView] = await Promise.all([
    supabase.from("leagues").select("id, name, slug, status").order("name"),
    loadAnalyticsView(supabase as any, userId),
  ]);
  fail(leaguesQuery.error, "home-leagues");
  const leagues = (leaguesQuery.data ?? []) as HomePageLoad["leagues"];
  const homeLeagueCards = await loadHomeLeagueCards(
    supabase,
    admin,
    leagues,
    userId,
  );
  const analyticsVisible =
    analyticsVisibleForHomeCards(homeLeagueCards) ||
    analyticsViewHasHistory(analyticsView);
  return { leagues, analyticsView, homeLeagueCards, analyticsVisible };
}
