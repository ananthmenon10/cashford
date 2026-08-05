import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLeagueIdentity } from "@/lib/gw-view";
import { loadSeasonView } from "@/lib/gw-season";
import { loadLeagueTablePage } from "@/lib/league-table-load";
import { LeagueShell } from "@/components/gw/LeagueShell";
import { LeagueTablePane } from "@/components/gw/LeaguePanes";

export const dynamic = "force-dynamic";

export default async function LeagueTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ gw?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const identity = await loadLeagueIdentity(supabase, slug);
  if (!identity) notFound();
  if (identity.participation.status !== "active" || identity.participation.format !== "gameweek") {
    redirect(`/leagues/${slug}/archive/wc2026`);
  }
  const admin = createServiceRoleClient();
  const [loaded, season] = await Promise.all([
    loadLeagueTablePage(supabase, admin, identity, user.id, undefined, query.gw),
    loadSeasonView(supabase, admin, identity, user.id),
  ]);
  return (
    <LeagueShell identity={identity} active="table" viewerName={season.viewerName ?? ""} selectedGameweek={query.gw}>
      <div className="mt-5"><LeagueTablePane view={loaded.view} current={loaded.current} season={season} /></div>
    </LeagueShell>
  );
}
