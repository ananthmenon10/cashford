import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { loadLeagueIdentity } from "@/lib/gw-view";
import { loadDuesView } from "@/lib/dues-view";
import { isCorrect, isExact, type Entry } from "@/lib/analytics";
import { combinedBalanceLabel } from "@/lib/wc-archive";
import { ArchiveShell } from "@/components/archive/ArchiveShell";
import { ARCHIVE_COPY, PHASE5_UI_COPY } from "@/lib/payment-copy";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function signedNet(value: number | null): string {
  if (value == null) return "—";
  if (value > 0) return `+₹${value.toLocaleString("en-IN")}`;
  if (value < 0) return `−₹${Math.abs(value).toLocaleString("en-IN")}`;
  return "₹0";
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

export default async function WcArchiveMatchesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const identity = await loadLeagueIdentity(supabase, slug);
  if (!identity) notFound();
  const admin = createServiceRoleClient();
  const dues = await loadDuesView(supabase, admin, identity, user.id);
  const wc = await admin.from("competitions").select("id").eq("slug", "wc2026").single();
  if (wc.error) throw new Error(`wc-matches-competition: ${wc.error.message}`);
  const query = await admin.from("contests").select("id, status, stake_inr, fixtures!inner(id, round, kickoff_at, home_label, away_label, home_team_id, away_team_id, ft_home, ft_away, status, competition_id, is_knockout, advancer_team_id)").eq("league_id", identity.league.id).eq("fixtures.competition_id", wc.data.id);
  if (query.error) throw new Error(`wc-matches: ${query.error.message}`);
  const contestIds = (query.data ?? []).map((row: any) => row.id);
  const [predictionsQ, resultsQ] = contestIds.length
    ? await Promise.all([
      admin.from("predictions").select("contest_id, outcome, pred_home, pred_away").eq("user_id", user.id).in("contest_id", contestIds),
      admin.from("contest_results").select("contest_id, net_inr").eq("user_id", user.id).in("contest_id", contestIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }] as const;
  if (predictionsQ.error) throw new Error(`wc-matches-predictions: ${predictionsQ.error.message}`);
  if (resultsQ.error) throw new Error(`wc-matches-results: ${resultsQ.error.message}`);
  const predictions = new Map((predictionsQ.data ?? []).map((row: any) => [row.contest_id, row]));
  const results = new Map((resultsQ.data ?? []).map((row: any) => [row.contest_id, Number(row.net_inr)]));
  const balance = dues.ledger.status === "clean" ? combinedBalanceLabel(dues.ledger.netByUser[user.id] ?? 0) : undefined;
  const rows = [...(query.data ?? [])].sort((a: any, b: any) => new Date(one<any>(b.fixtures)?.kickoff_at).getTime() - new Date(one<any>(a.fixtures)?.kickoff_at).getTime());
  return <ArchiveShell slug={slug} leagueName={identity.league.name} viewerName={dues.viewerName} balance={balance} active="matches"><p className="mt-4 text-[12px] text-muted">{ARCHIVE_COPY.matchesNotice}</p><div className="mt-4 flex flex-col gap-2">{rows.map((row: any) => {
    const fixture = one<any>(row.fixtures);
    const pick = predictions.get(row.id);
    const net = results.has(row.id) ? results.get(row.id)! : null;
    const finished = fixture?.ft_home != null && fixture?.ft_away != null;
    const advancer = fixture?.advancer_team_id === fixture?.home_team_id ? "home" : fixture?.advancer_team_id === fixture?.away_team_id ? "away" : null;
    const entry = pick && finished ? { outcome: pick.outcome, predHome: pick.pred_home, predAway: pick.pred_away, ftHome: fixture.ft_home, ftAway: fixture.ft_away, isKnockout: fixture.is_knockout, advancer, net, kickoffMs: new Date(fixture.kickoff_at).getTime(), dayKey: "", homeLabel: fixture.home_label, awayLabel: fixture.away_label } as Entry : null;
    const verdict = !pick ? "You sat this one out" : !finished ? ARCHIVE_COPY.resultUnavailable : entry && isExact(entry) ? "Exact" : entry && isCorrect(entry) ? "Right result" : "Miss";
    return <Link key={row.id} href={`/leagues/${slug}/m/${fixture.id}`} className="rounded-card border border-border bg-surface p-4"><div className="flex items-center justify-between text-[10px] font-bold uppercase text-muted"><span>{fixture.round}</span><time dateTime={fixture.kickoff_at}>{dateLabel(fixture.kickoff_at)}</time></div><div className="mt-1 text-[13px] font-bold">{fixture.home_label} {fixture.ft_home ?? "—"} · {fixture.away_label} {fixture.ft_away ?? "—"}</div><div className="mt-3 flex items-center justify-between text-[12px]"><span>{pick ? `${PHASE5_UI_COPY.yourWorldCup}: ${pick.pred_home}–${pick.pred_away}` : verdict}</span><span className="font-semibold">{verdict}</span></div><div className="mt-1 text-right font-mono text-[12px] font-bold">{signedNet(net)}</div></Link>;
  })}</div></ArchiveShell>;
}
