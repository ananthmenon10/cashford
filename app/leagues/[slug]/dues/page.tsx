import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadDuesView } from "@/lib/dues-view";
import { loadGameweekView, loadLeagueIdentity, type GameweekViewDTO } from "@/lib/gw-view";
import { LeagueShell } from "@/components/gw/LeagueShell";
import { DuesHeader } from "@/components/dues/DuesHeader";
import { NetPositionTable } from "@/components/dues/NetPositionTable";
import { SettlePlan } from "@/components/dues/SettlePlan";
import { PendingPaymentCard } from "@/components/dues/PendingPaymentCard";
import { ActivityFeed } from "@/components/dues/ActivityFeed";
import { LedgerSyncIssue } from "@/components/dues/LedgerSyncIssue";
import { RecalculatingNote } from "@/components/gw/RecalculatingNote";
import { DUES_COPY } from "@/lib/payment-copy";

function shellView(identity: Awaited<ReturnType<typeof loadLeagueIdentity>>): Pick<GameweekViewDTO, "league" | "participation" | "gameweek" | "adjacentGameweeks"> {
  if (!identity) throw new Error("dues-identity");
  return { league: identity.league, participation: identity.participation, gameweek: null, adjacentGameweeks: [] };
}

export default async function DuesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const identity = await loadLeagueIdentity(supabase, slug);
  if (!identity) notFound();
  const admin = createServiceRoleClient();
  const dues = await loadDuesView(supabase, admin, identity, user.id);
  const current = identity.participation.format === "gameweek" && identity.participation.status === "active"
    ? await loadGameweekView(supabase, admin, identity, user.id, undefined, new Date(), false)
    : shellView(identity);
  const names = new Map(dues.people.map((person) => [person.id, person.name]));
  const clean = dues.ledger.status === "clean";
  return <LeagueShell view={current} active="dues" viewerName={dues.viewerName} showCompetitionSheet={false}>
    <DuesHeader />
    {dues.ledger.status === "recalculating" ? <RecalculatingNote /> : dues.ledger.status === "sync_issue" ? <LedgerSyncIssue leagueId={identity.league.id} fingerprint={dues.ledger.detailFingerprint} /> : null}
    {dues.pending.filter((payment) => payment.viewerMustAnswer).map((payment) => <div key={payment.id} className="mt-3"><PendingPaymentCard payment={payment} names={names} /></div>)}
    {dues.ledger.status === "clean" ? <><NetPositionTable people={dues.people} /><SettlePlan plan={dues.ledger.plan} names={names} slug={slug} viewerId={user.id} /></> : null}
    {!clean ? <p className="mt-5 text-[12px] text-muted">{DUES_COPY.boundary}</p> : null}
    <a href={`/leagues/${slug}/dues/log`} className="mt-5 block rounded-control bg-primary py-3 text-center text-[13px] font-bold text-white">{DUES_COPY.logPayment}</a>
    <ActivityFeed items={dues.activity} names={names} />
  </LeagueShell>;
}
