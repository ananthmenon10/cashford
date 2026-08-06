import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLeagueIdentity } from "@/lib/gw-view";
import { loadWcArchivePage } from "@/lib/wc-archive-load";
import { ArchiveShell } from "@/components/archive/ArchiveShell";
import { WcFinalStandings } from "@/components/archive/WcFinalStandings";
import { WcRecap } from "@/components/archive/WcRecap";
import { WcRules } from "@/components/archive/WcRules";
import { ARCHIVE_COPY, TRANSITION_COPY } from "@/lib/payment-copy";
import { CaptainAdoptionSheet } from "@/components/gw/CaptainAdoptionSheet";

export default async function WcArchivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const identity = await loadLeagueIdentity(supabase, slug);
  if (!identity) notFound();
  const loaded = await loadWcArchivePage(supabase, createServiceRoleClient(), identity, user.id);
  const {
    dues, standings, lateMembers, mine, mineIsLate, pl, leagueConfig, nextPl,
    balance, matchesSettled, liveCompetition, transition, freezeDate, captainName,
    otherActiveCompetitionName,
  } = loaded;
  const snapshot = { matchesSettled, finish: mine?.finish ?? null, netInr: mine?.netInr ?? null };
  return (
    <ArchiveShell
      slug={slug}
      leagueName={identity.league.name}
      viewerName={dues.viewerName}
      balance={balance}
      active="analytics"
      snapshot={snapshot}
      liveCompetition={liveCompetition}
    >
      <p className="mt-4 text-[12px] text-muted">
        {freezeDate ? ARCHIVE_COPY.freeze(freezeDate) : ARCHIVE_COPY.freezeUnset}
      </p>
      <WcFinalStandings rows={standings} lateMembers={lateMembers} />
      <WcRecap row={mine} mineIsLate={mineIsLate} />
      <WcRules />
      {transition === "captain_adopt" && pl ? (
        <CaptainAdoptionSheet
          slug={slug}
          leagueId={identity.league.id}
          competitionSlug={pl.slug}
          anteInr={Number(leagueConfig?.default_stake_inr ?? 500)}
          gameweekNumber={nextPl?.number ?? null}
          deadlineAt={nextPl?.deadline_at ?? null}
        />
      ) : null}
      {transition === "member_waiting" ? (
        <section className="mt-4 rounded-card border border-border bg-surface p-4 text-[13px]">
          <h2 className="font-extrabold">{TRANSITION_COPY.memberHeading(captainName)}</h2>
          <p className="mt-1 text-muted">{TRANSITION_COPY.memberBody}</p>
        </section>
      ) : null}
      {transition === "preparing" ? (
        <p className="mt-4 text-[12px] text-muted">{TRANSITION_COPY.preparing}</p>
      ) : null}
      {transition === "blocked" && otherActiveCompetitionName ? (
        <p className="mt-4 text-[12px] text-muted">{TRANSITION_COPY.otherActive(otherActiveCompetitionName)}</p>
      ) : null}
      {transition === "archived" && pl ? (
        <p className="mt-4 text-[12px] text-muted">{TRANSITION_COPY.archivedTarget(pl.name)}</p>
      ) : null}
    </ArchiveShell>
  );
}
