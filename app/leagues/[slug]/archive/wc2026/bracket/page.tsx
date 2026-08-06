import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLeagueIdentity } from "@/lib/gw-view";
import { loadWcArchiveBracketPage } from "@/lib/wc-archive-load";
import { KnockoutCircle } from "@/components/KnockoutCircle";
import { KnockoutLeaderboard } from "@/components/KnockoutLeaderboard";
import { ArchiveShell } from "@/components/archive/ArchiveShell";
import { ARCHIVE_COPY } from "@/lib/payment-copy";

export default async function WcArchiveBracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) notFound(); const identity = await loadLeagueIdentity(supabase, slug); if (!identity) notFound(); const { dues, view, boards, balance, liveCompetition } = await loadWcArchiveBracketPage(supabase, createServiceRoleClient(), identity, user.id);
  {/* Dual-review fix (R1 nit 2): the league-wide leaderboard must not depend on the viewer's
      own bracket lock — a member who never locked their own bracket still gets to see how
      everyone else in the league finished. Only the viewer's own circle is gated on it. */}
  return <ArchiveShell slug={slug} leagueName={identity.league.name} viewerName={dues.viewerName} balance={balance} active="bracket" liveCompetition={liveCompetition}><p className="mt-4 text-[12px] text-muted">{ARCHIVE_COPY.bracketNotice}</p>{view.locked ? <div className="mt-4"><KnockoutCircle view={view} readOnly /></div> : <p className="mt-4 text-[12px] text-muted">{ARCHIVE_COPY.noBracket}</p>}<div className="mt-4"><KnockoutLeaderboard leaderboards={boards.filter((board) => board.leagueId === identity.league.id)} /></div></ArchiveShell>;
}
