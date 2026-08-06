import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLeagueIdentity } from "@/lib/gw-view";
import { loadWcArchivePage } from "@/lib/wc-archive-load";
import { ArchiveShell } from "@/components/archive/ArchiveShell";
import { WcFinalStandings } from "@/components/archive/WcFinalStandings";
import { WcRecap } from "@/components/archive/WcRecap";
import { WcRules } from "@/components/archive/WcRules";
import { ARCHIVE_COPY } from "@/lib/payment-copy";
import { CaptainAdoptionSheet } from "@/components/gw/CaptainAdoptionSheet";

export default async function WcArchivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) notFound(); const identity = await loadLeagueIdentity(supabase, slug); if (!identity) notFound(); const loaded = await loadWcArchivePage(supabase, createServiceRoleClient(), identity, user.id);
  const { dues, standings, mine, pl, plParticipation, leagueConfig, nextPl, balance, matchesSettled, liveCompetition } = loaded;
  const isCaptain = identity.league.createdBy === user.id;
  const snapshot = { matchesSettled, finish: mine?.finish ?? null, netInr: mine?.netInr ?? null };
  return <ArchiveShell slug={slug} leagueName={identity.league.name} viewerName={dues.viewerName} balance={balance} active="analytics" snapshot={snapshot} liveCompetition={liveCompetition}><p className="mt-4 text-[12px] text-muted">{ARCHIVE_COPY.freeze("final settlement")}</p><WcFinalStandings rows={standings} /><WcRecap row={mine} /><WcRules />{pl?.status === "active" && !plParticipation && isCaptain ? <CaptainAdoptionSheet slug={slug} leagueId={identity.league.id} anteInr={Number(leagueConfig?.default_stake_inr ?? 500)} gameweekNumber={nextPl?.number ?? null} deadlineAt={nextPl?.deadline_at ?? null} /> : null}</ArchiveShell>;
}
