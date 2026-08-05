import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLeagueIdentity } from "@/lib/gw-view";
import { loadLeagueTablePage } from "@/lib/league-table-load";
import { LeagueShell } from "@/components/gw/LeagueShell";
import { CompetitionTable } from "@/components/matches/CompetitionTable";

export const dynamic = "force-dynamic";

export default async function LeagueTablePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) notFound();
  const identity = await loadLeagueIdentity(supabase, slug); if (!identity) notFound();
  if (identity.participation.status !== "active" || identity.participation.format !== "gameweek") redirect(`/leagues/${slug}/archive/wc2026`);
  const loaded = await loadLeagueTablePage(supabase, createServiceRoleClient(), identity, user.id);
  return <LeagueShell view={loaded.current} active="table" viewerName={(user.user_metadata?.username as string | undefined) ?? user.email?.split("@")[0] ?? "you"}><div className="mt-5"><CompetitionTable view={loaded.view} /></div></LeagueShell>;
}
