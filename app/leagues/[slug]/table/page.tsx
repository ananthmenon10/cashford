import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLeagueIdentity, loadGameweekView } from "@/lib/gw-view";
import { selectStandingsRow, buildStandingsView, type StandingsCacheRow } from "@/lib/standings-view";
import type { CompetitionStanding } from "@/lib/espn-standings";
import { LeagueShell } from "@/components/gw/LeagueShell";
import { CompetitionTable } from "@/components/matches/CompetitionTable";

export const dynamic = "force-dynamic";

export default async function LeagueTablePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) notFound();
  const identity = await loadLeagueIdentity(supabase, slug); if (!identity) notFound();
  if (identity.participation.status !== "active" || identity.participation.format !== "gameweek") redirect(`/leagues/${slug}/archive/wc2026`);
  const admin = createServiceRoleClient(); const current = await loadGameweekView(supabase, admin, identity, user.id, undefined, new Date(), false);
  const query = await admin.from("competition_standings").select("source,rows,note,fetched_at").eq("competition_id", identity.participation.competitionId).order("source", { ascending: true }); if (query.error) throw new Error(`league-table: ${query.error.message}`);
  const standing = selectStandingsRow((query.data ?? []) as StandingsCacheRow[], new Date(), false); const view = standing && Array.isArray(standing.rows) ? buildStandingsView({ rows: standing.rows as CompetitionStanding[], source: standing.source, fetchedAt: standing.fetched_at, note: standing.note }) : null;
  return <LeagueShell view={current} active="table" viewerName={(user.user_metadata?.username as string | undefined) ?? user.email?.split("@")[0] ?? "you"}><div className="mt-5"><CompetitionTable view={view} /></div></LeagueShell>;
}

