import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadGameweekView, loadLeagueIdentity } from "@/lib/gw-view";
import { loadSeasonView } from "@/lib/gw-season";
import { C29 } from "@/lib/gw-copy";
import { LeagueShell } from "@/components/gw/LeagueShell";
import { SeasonTable } from "@/components/gw/SeasonTable";
import { EmptyState } from "@/components/gw/EmptyState";

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
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
      {season.rows.length || season.totals.length ? (
        <SeasonTable slug={slug} view={season} />
      ) : (
        <EmptyState copy={C29} />
      )}
    </LeagueShell>
  );
}
