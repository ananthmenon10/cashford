import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLeagueIdentity } from "@/lib/gw-view";
import { loadWcArchiveMatchesPage } from "@/lib/wc-archive-load";
import { isCorrect, isExact, type Entry } from "@/lib/analytics";
import { ArchiveShell } from "@/components/archive/ArchiveShell";
import { ARCHIVE_COPY, PHASE5_UI_COPY } from "@/lib/payment-copy";
import { LocalTime } from "@/components/LocalTime";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function signedNet(value: number | null): string {
  if (value == null) return "—";
  if (value > 0) return `+₹${value.toLocaleString("en-IN")}`;
  if (value < 0) return `−₹${Math.abs(value).toLocaleString("en-IN")}`;
  return "₹0";
}

export default async function WcArchiveMatchesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const identity = await loadLeagueIdentity(supabase, slug);
  if (!identity) notFound();
  const loaded = await loadWcArchiveMatchesPage(supabase, createServiceRoleClient(), identity, user.id);
  const { dues, balance, rows, predictions, results } = loaded;
  return <ArchiveShell slug={slug} leagueName={identity.league.name} viewerName={dues.viewerName} balance={balance} active="matches"><p className="mt-4 text-[12px] text-muted">{ARCHIVE_COPY.matchesNotice}</p><div className="mt-4 flex flex-col gap-2">{rows.map((row: any) => {
    const fixture = one<any>(row.fixtures);
    const pick = predictions.get(row.id);
    const net = results.has(row.id) ? results.get(row.id)! : null;
    const finished = fixture?.ft_home != null && fixture?.ft_away != null;
    const advancer = fixture?.advancer_team_id === fixture?.home_team_id ? "home" : fixture?.advancer_team_id === fixture?.away_team_id ? "away" : null;
    const entry = pick && finished ? { outcome: pick.outcome, predHome: pick.pred_home, predAway: pick.pred_away, ftHome: fixture.ft_home, ftAway: fixture.ft_away, isKnockout: fixture.is_knockout, advancer, net, kickoffMs: new Date(fixture.kickoff_at).getTime(), dayKey: "", homeLabel: fixture.home_label, awayLabel: fixture.away_label } as Entry : null;
    const verdict = !pick ? "You sat this one out" : !finished ? ARCHIVE_COPY.resultUnavailable : entry && isExact(entry) ? "Exact" : entry && isCorrect(entry) ? "Right result" : "Miss";
    return <Link key={row.id} href={`/leagues/${slug}/m/${fixture.id}`} className="rounded-card border border-border bg-surface p-4"><div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted"><span>{fixture.round}</span><LocalTime iso={fixture.kickoff_at} variant="date" relative={false} /></div><div className="mt-1 text-[13px] font-bold">{fixture.home_label} {fixture.ft_home ?? "—"} · {fixture.away_label} {fixture.ft_away ?? "—"}</div><div className="mt-3 flex items-center justify-between text-[12px]"><span>{pick ? `${PHASE5_UI_COPY.yourWorldCup}: ${pick.pred_home}–${pick.pred_away}` : verdict}</span><span className="font-semibold">{verdict}</span></div><div className="mt-1 text-right font-mono text-[12px] font-bold">{signedNet(net)}</div></Link>;
  })}</div></ArchiveShell>;
}
