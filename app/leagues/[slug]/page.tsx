import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { C70 } from "@/lib/gw-copy";
import { loadGameweekView, loadLeagueIdentity } from "@/lib/gw-view";
import { LeagueShell } from "@/components/gw/LeagueShell";
import { EmptyState } from "@/components/gw/EmptyState";
import { LeagueGameweekPane } from "@/components/gw/LeaguePanes";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LeaguePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ gw?: string }>;
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
  if (identity.participation.status === "archived" && identity.participation.competitionSlug === "wc2026") redirect(`/leagues/${slug}/archive/wc2026`);
  if (identity.participation.status === "none") {
    return (
      <main className="min-h-screen bg-cs2-canvas px-4 py-12 text-cs2-ink">
        <div className="mx-auto max-w-[520px]">
          <EmptyState copy={C70} />
        </div>
      </main>
    );
  }
  if (identity.participation.status !== "active" || identity.participation.format !== "gameweek") {
    redirect(`/leagues/${slug}/archive/wc2026`);
  }

  const current = await loadGameweekView(
    supabase,
    createServiceRoleClient(),
    identity,
    user.id,
    query.gw,
  );
  const viewerName =
    (user.user_metadata?.username as string | undefined) ??
    user.email?.split("@")[0] ??
    "";

  return (
    <LeagueShell
      identity={identity}
      active="gameweek"
      viewerName={viewerName}
      selectedGameweek={current.gameweek?.number}
    >
      <LeagueGameweekPane view={current} />
    </LeagueShell>
  );
}
