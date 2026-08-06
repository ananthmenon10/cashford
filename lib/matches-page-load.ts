import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMatchesTab } from "./matches-tab-load";
import {
  buildStandingsView,
  selectStandingsRow,
  type StandingsCacheRow,
  type StandingsView,
} from "./standings-view";
import type { CompetitionStanding } from "./espn-standings";
import type { MatchesTabView } from "./matches-tab";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

export type MatchesPageLoad = {
  view: MatchesTabView;
  standings: StandingsView | null;
  segment: "fixtures" | "table";
};

/** The server-side read path used by app/matches/page.tsx. */
export async function loadMatchesPage(
  session: CashfordClient,
  admin: CashfordClient,
  userId: string,
  requestedGw?: number,
  requestedView?: string,
  requestedScopeSlug?: string,
): Promise<MatchesPageLoad | null> {
  const view = await loadMatchesTab(
    session as any,
    userId,
    requestedGw,
    undefined,
    requestedScopeSlug,
  );
  if (!view) return null;

  const [{ data: standingRows, error }, { data: liveRows, error: liveError }] =
    await Promise.all([
      admin
        .from("competition_standings")
        .select("source,rows,note,fetched_at")
        .eq("competition_id", view.competition.id)
        .order("source", { ascending: true }),
      admin
        .from("fixtures")
        .select("id")
        .eq("competition_id", view.competition.id)
        .eq("status", "live")
        .limit(1),
    ]);
  fail(error, "matches standings");
  fail(liveError, "matches live check");

  const standing = selectStandingsRow(
    (standingRows ?? []) as StandingsCacheRow[],
    new Date(),
    !!liveRows?.length,
  );
  const standings =
    standing && Array.isArray(standing.rows)
      ? buildStandingsView({
          rows: standing.rows as CompetitionStanding[],
          source: standing.source,
          fetchedAt: standing.fetched_at,
          note: standing.note,
        })
      : null;

  return {
    view,
    standings,
    segment: requestedView === "table" ? "table" : "fixtures",
  };
}
