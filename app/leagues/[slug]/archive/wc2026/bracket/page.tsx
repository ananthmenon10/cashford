import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLeagueIdentity } from "@/lib/gw-view";
import { loadDuesView } from "@/lib/dues-view";
import { combinedBalanceLabel } from "@/lib/wc-archive";
import { loadKnockoutView, loadKnockoutLeaderboards } from "@/lib/knockout-data";
import { KnockoutCircle } from "@/components/KnockoutCircle";
import { KnockoutLeaderboard } from "@/components/KnockoutLeaderboard";
import { ArchiveShell } from "@/components/archive/ArchiveShell";
import { ARCHIVE_COPY } from "@/lib/payment-copy";

export default async function WcArchiveBracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) notFound(); const identity = await loadLeagueIdentity(supabase, slug); if (!identity) notFound(); const dues = await loadDuesView(supabase, createServiceRoleClient(), identity, user.id); const view = await loadKnockoutView(supabase, user.id); const boards = await loadKnockoutLeaderboards(supabase, user.id, view.results); const balance = dues.ledger.status === "clean" ? combinedBalanceLabel(dues.ledger.netByUser[user.id] ?? 0) : undefined;
  return <ArchiveShell slug={slug} leagueName={identity.league.name} viewerName={dues.viewerName} balance={balance} active="bracket"><p className="mt-4 text-[12px] text-muted">{ARCHIVE_COPY.bracketNotice}</p><div className="mt-4"><KnockoutCircle view={view} readOnly /><KnockoutLeaderboard leaderboards={boards.filter((board) => board.leagueId === identity.league.id)} /></div></ArchiveShell>;
}
