import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadDuesView } from "@/lib/dues-view";
import { loadLeagueIdentity } from "@/lib/gw-view";
import { LeagueShell } from "@/components/gw/LeagueShell";
import { LeagueDuesPane } from "@/components/gw/LeaguePanes";

export const dynamic = "force-dynamic";

export default async function DuesPage({
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
  const dues = await loadDuesView(supabase, admin, identity, user.id);
  return (
    <LeagueShell
      identity={identity}
      active="dues"
      viewerName={dues.viewerName}
      showCompetitionSheet={false}
      selectedGameweek={query.gw}
    >
      <LeagueDuesPane view={dues} />
    </LeagueShell>
  );
}
