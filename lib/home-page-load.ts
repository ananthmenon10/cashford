import type { SupabaseClient } from "@supabase/supabase-js";
import { viewerHasSettledCupHistory } from "./home-analytics";
import {
  analyticsVisibleForHomeCards,
  loadHomeLeagueCards,
  type HomeLeagueCard,
} from "./gw-home";
import { loadAnalyticsFeed, type AnalyticsFeedView } from "./analytics-feed-load";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

export type HomePageLoad = {
  leagues: { id: string; name: string; slug: string; status: string }[];
  homeLeagueCards: HomeLeagueCard[];
  analyticsVisible: boolean;
  analyticsFeed: AnalyticsFeedView;
};

/** The server-side read path used by app/page.tsx. */
export async function loadHomePage(
  supabase: CashfordClient,
  admin: CashfordClient,
  userId: string,
): Promise<HomePageLoad> {
  const leaguesQuery = await supabase
    .from("leagues")
    .select("id, name, slug, status")
    .order("name");
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
    await viewerHasSettledCupHistory(supabase as any, userId);
  // Step 8: the new feed is loaded whenever analytics is visible at all (same #14 gate) — no
  // extra query cost when the tab is hidden pre-GW1.
  const analyticsFeed = analyticsVisible
    ? await loadAnalyticsFeed(supabase, admin, leagues, userId)
    : { leagueOptions: [], sections: [], myFormByLeague: {}, allTimeStrip: null };
  return { leagues, homeLeagueCards, analyticsVisible, analyticsFeed };
}
