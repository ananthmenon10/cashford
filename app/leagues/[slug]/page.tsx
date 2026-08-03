import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { C29, C57, C70 } from "@/lib/gw-copy";
import { loadGameweekView, loadLeagueIdentity } from "@/lib/gw-view";
import { LeagueShell } from "@/components/gw/LeagueShell";
import { StateHeader } from "@/components/gw/StateHeader";
import { EmptyState } from "@/components/gw/EmptyState";
import { PotSummary } from "@/components/gw/PotSummary";
import { EntryCta } from "@/components/gw/EntryCta";
import { EntryCard } from "@/components/gw/EntryCard";
import { NeedsUpdateNudge } from "@/components/gw/NeedsUpdateNudge";
import { Standings } from "@/components/gw/Standings";
import { FixtureRow } from "@/components/gw/FixtureRow";
import { redirect } from "next/navigation";

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

  const now = new Date();
  const view = await loadGameweekView(
    supabase,
    createServiceRoleClient(),
    identity,
    user.id,
    query.gw,
    now,
  );
  const viewerName =
    (user.user_metadata?.username as string | undefined) ??
    user.email?.split("@")[0] ??
    "";

  return (
    <LeagueShell view={view} active="gameweek" viewerName={viewerName}>
      {!view.gameweek || !view.contest || view.lifecycle === "CL0" ? (
        <EmptyState copy={C29} />
      ) : (
        <>
          <StateHeader view={view} />
          {view.lifecycle !== "CL9" && view.isDoubleGameweek ? (
            <p className="mt-3 rounded-cs2-md border border-cs2-line bg-cs2-paper px-4 py-3 text-[12px] font-semibold text-cs2-ink-2">
              {C57(
                view.gameweek.number,
                view.fixtures.filter((fixture) => fixture.state === "active").length,
              )}
            </p>
          ) : null}
          {view.lifecycle !== "CL9" &&
          ["CL1", "CL2", "CL3", "CL4"].includes(view.lifecycle) ? (
            <PotSummary
              stakeInr={view.contest.stakeInr}
              potInr={view.potInr}
              entered={view.enteredCount}
              eligible={view.eligibleCount}
              contestStatus={view.contest.status}
              deadlineAt={view.contest.deadlineAt}
              now={now.getTime()}
            />
          ) : null}
          {view.lifecycle !== "CL9" &&
          (view.viewerParticipation === "VP2" || view.viewerParticipation === "VP3") ? (
            <EntryCard fixtures={view.fixtures} picks={view.viewerPicks} />
          ) : null}
          {view.lifecycle !== "CL9" &&
          view.viewerParticipation === "VP3" &&
          view.lifecycle === "CL1" ? (
            <NeedsUpdateNudge />
          ) : null}
          {view.lifecycle !== "CL9" && view.render.showCta ? (
            <EntryCta
              slug={view.league.slug}
              gameweekNumber={view.gameweek.number}
              stakeInr={view.contest.stakeInr}
              participation={view.viewerParticipation}
            />
          ) : null}
          {view.lifecycle !== "CL9" && view.render.showStandings ? (
            <Standings rows={view.standings} showMoney={view.render.showMoney} />
          ) : null}
          {view.lifecycle !== "CL1" &&
          view.lifecycle !== "CL9" &&
          view.lifecycle !== "CL10" ? (
            <div className="mt-5 rounded-cs2-md border border-cs2-line bg-cs2-paper px-4">
              {view.fixtures.map((fixture) => (
                <FixtureRow
                  key={fixture.fixtureId}
                  fixture={fixture}
                  picks={view.revealedPicks}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </LeagueShell>
  );
}
