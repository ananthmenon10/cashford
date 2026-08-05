import type { SupabaseClient } from "@supabase/supabase-js";
import { loadGameweekView, type LeagueIdentity } from "./gw-view";
import {
  buildStandingsView,
  selectStandingsRow,
  type StandingsCacheRow,
  type StandingsView,
} from "./standings-view";
import type { CompetitionStanding } from "./espn-standings";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

export type LeagueTablePageLoad = {
  current: Awaited<ReturnType<typeof loadGameweekView>>;
  view: StandingsView | null;
};

/** The server-side read path used by app/leagues/[slug]/table/page.tsx. */
export async function loadLeagueTablePage(
  session: CashfordClient,
  admin: CashfordClient,
  identity: LeagueIdentity,
  userId: string,
): Promise<LeagueTablePageLoad> {
  const current = await loadGameweekView(
    session as any,
    admin as any,
    identity,
    userId,
    undefined,
    new Date(),
    false,
  );
  const query = await admin
    .from("competition_standings")
    .select("source,rows,note,fetched_at")
    .eq("competition_id", identity.participation.competitionId)
    .order("source", { ascending: true });
  fail(query.error, "league-table");
  const standing = selectStandingsRow(
    (query.data ?? []) as StandingsCacheRow[],
    new Date(),
    false,
  );
  const view =
    standing && Array.isArray(standing.rows)
      ? buildStandingsView({
          rows: standing.rows as CompetitionStanding[],
          source: standing.source,
          fetchedAt: standing.fetched_at,
          note: standing.note,
        })
      : null;
  return { current, view };
}
