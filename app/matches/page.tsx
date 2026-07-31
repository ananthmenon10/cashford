import { notFound } from "next/navigation";
import { Phase4MatchesPage } from "@/components/Phase4MatchesPage";
import { loadMatchesTab } from "@/lib/matches-tab-load";
import {
  buildStandingsView,
  selectStandingsRow,
  type StandingsCacheRow,
} from "@/lib/standings-view";
import type { CompetitionStanding } from "@/lib/espn-standings";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ gw?: string; view?: string }>;
}) {
  const query = await searchParams;
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) notFound();
  const admin = createServiceRoleClient();
  const requestedGw = query.gw ? Number(query.gw) : undefined;
  const view = await loadMatchesTab(
    session,
    user.id,
    Number.isInteger(requestedGw) ? requestedGw : undefined,
  );
  if (!view) notFound();

  const [
    { data: standingRows, error },
    { data: liveRows, error: liveError },
  ] = await Promise.all([
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
  if (error) throw new Error(`matches standings: ${error.message}`);
  if (liveError) throw new Error(`matches live check: ${liveError.message}`);
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

  return (
    <Phase4MatchesPage
      view={view}
      standings={standings}
      segment={query.view === "table" ? "table" : "fixtures"}
    />
  );
}
