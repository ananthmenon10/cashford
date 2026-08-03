import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadGameweekView, loadLeagueIdentity } from "@/lib/gw-view";
import { loadSeasonView } from "@/lib/gw-season";
import { C29 } from "@/lib/gw-copy";
import { LeagueShell } from "@/components/gw/LeagueShell";
import { SeasonTable } from "@/components/gw/SeasonTable";
import { EmptyState } from "@/components/gw/EmptyState";
import { SeasonViewPills } from "@/components/gw/SeasonViewPills";

export default async function SeasonPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; gw?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const identity = await loadLeagueIdentity(supabase, slug);
  if (!identity) notFound();
  if (
    identity.participation.status === "none" ||
    identity.participation.format !== "gameweek"
  ) {
    redirect(`/leagues/${slug}`);
  }
  const admin = createServiceRoleClient();
  const [current, season] = await Promise.all([
    loadGameweekView(
      supabase,
      admin,
      identity,
      user.id,
      undefined,
      new Date(),
      false,
    ),
    loadSeasonView(supabase, admin, identity, user.id),
  ]);
  const viewerName =
    (user.user_metadata?.username as string | undefined) ??
    user.email?.split("@")[0] ??
    "";

  return (
    <LeagueShell view={current} active="season" viewerName={viewerName}>
      <SeasonViewPills slug={slug} view={query.view === "gameweeks" ? "gameweeks" : "table"} gw={query.gw} />
      {season.rows.length || season.totals.length ? (
        <SeasonTable slug={slug} view={season} pane={query.view === "gameweeks" ? "gameweeks" : "table"} />
      ) : (
        <EmptyState copy={C29} />
      )}
    </LeagueShell>
  );
}
