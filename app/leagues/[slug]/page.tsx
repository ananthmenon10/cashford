import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deriveCardState, tabForState, type ContestStatus, type FixtureStatus, type ResultKind } from "@/lib/contest-state";
import { MatchCard, type CardData } from "@/components/MatchCard";
import { LeagueTabs } from "@/components/LeagueTabs";
import { Avatar, inr } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BackLink } from "@/components/BackLink";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { pollScores } from "@/lib/espn";
import { simplifyDebts } from "@/lib/settlement";
import { after } from "next/server";

export default async function LeaguePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Freshen live scores from ESPN AFTER the response is sent (non-blocking, so it
  // never slows the page); the guard skips the ESPN call if nothing is live.
  after(async () => { try { await pollScores(createServiceRoleClient()); } catch {} });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: league } = await supabase.from("leagues").select("id, name, slug").eq("slug", slug).single();
  if (!league) notFound(); // not a member (RLS) or bad slug

  const memberIds = (await supabase.from("league_members").select("user_id").eq("league_id", league.id)).data?.map((m) => m.user_id) ?? [];
  const [{ data: contests }, { data: teams }, { data: myPreds }, { data: myResults }, { data: members }, { data: allResults }] =
    await Promise.all([
      supabase.from("contests")
        .select("id, status, lock_at, stake_inr, is_knockout, fixtures(round, home_label, away_label, home_team_id, away_team_id, kickoff_at, status, status_detail, ft_home, ft_away, minute, advancer_team_id)")
        .eq("league_id", league.id),
      supabase.from("teams").select("id, short_name"),
      supabase.from("predictions").select("contest_id, outcome, pred_home, pred_away").eq("user_id", user!.id),
      supabase.from("contest_results").select("contest_id, result, net_inr").eq("user_id", user!.id),
      supabase.from("profiles").select("id, display_name, username").in("id", memberIds),
      supabase.from("contest_results").select("user_id, net_inr, contests!inner(league_id)").eq("contests.league_id", league.id),
    ]);

  const short = new Map((teams ?? []).map((t) => [t.id, t.short_name as string | null]));
  const predByContest = new Map((myPreds ?? []).map((p) => [p.contest_id, p]));
  const resByContest = new Map((myResults ?? []).map((r) => [r.contest_id, r]));
  const now = Date.now();

  const cards: CardData[] = (contests ?? [])
    .map((c) => {
      // supabase returns embedded one-to-one as object (typed as array by the client) — normalize
      const f = (Array.isArray(c.fixtures) ? c.fixtures[0] : c.fixtures) as any;
      if (!f) return null;
      const mine = predByContest.get(c.id);
      const res = resByContest.get(c.id);
      const advancerSide = f.advancer_team_id
        ? f.advancer_team_id === f.home_team_id ? "home" : "away"
        : null;
      const state = deriveCardState({
        contestStatus: c.status as ContestStatus,
        fixtureStatus: f.status as FixtureStatus,
        lockAtMs: new Date(c.lock_at).getTime(),
        nowMs: now,
        isKnockout: c.is_knockout,
        homeKnown: !!f.home_team_id,
        awayKnown: !!f.away_team_id,
        hasMyPrediction: !!mine,
        myResult: (res?.result ?? (mine ? null : "not_entered")) as ResultKind | null,
      });
      return {
        contestId: c.id, slug: league.slug, state,
        round: f.round, isKnockout: c.is_knockout,
        homeLabel: f.home_label, awayLabel: f.away_label,
        homeShort: short.get(f.home_team_id), awayShort: short.get(f.away_team_id),
        kickoffIso: f.kickoff_at, lockIso: c.lock_at, stake: c.stake_inr,
        ftHome: f.ft_home, ftAway: f.ft_away, minute: f.minute, statusDetail: f.status_detail,
        advancerSide,
        my: mine ? { outcome: mine.outcome, predHome: mine.pred_home, predAway: mine.pred_away } : null,
        myNet: res?.net_inr ?? null,
        _kickoff: new Date(f.kickoff_at).getTime(),
      } as CardData & { _kickoff: number };
    })
    .filter(Boolean) as (CardData & { _kickoff: number })[];

  cards.sort((a: any, b: any) => a._kickoff - b._kickoff);

  const groups = { upcoming: [] as CardData[], live: [] as CardData[], done: [] as CardData[] };
  for (const c of cards) groups[tabForState(c.state)].push(c);

  // Your net in THIS league = Σ of your contest_results scoped to this league's
  // contests (allResults is filtered to league.id; myResults spans all leagues).
  const myNet = (allResults ?? [])
    .filter((r) => r.user_id === user!.id)
    .reduce((t, r) => t + (r.net_inr ?? 0), 0);

  // Dues: net leaderboard + per-viewer "who owes whom".
  const nameById = new Map((members ?? []).map((m) => [m.id, m.display_name || m.username]));
  const netByUser = new Map<string, number>(memberIds.map((id) => [id, 0]));
  for (const r of allResults ?? []) netByUser.set(r.user_id, (netByUser.get(r.user_id) ?? 0) + (r.net_inr ?? 0));
  const leaderboard = [...netByUser.entries()]
    .map(([id, net]) => ({ id, name: nameById.get(id) ?? "?", net }))
    .sort((a, b) => b.net - a.net);
  // Simplified settle-up: build the league-wide minimal payment plan ONCE from the
  // same nets as the leaderboard (so the two can never disagree), then filter to the
  // viewer. A single canonical plan means both ends of a transfer see matching amounts;
  // losers only pay, winners only receive, break-even players never appear (plan §17.8).
  const plan = simplifyDebts(Object.fromEntries(netByUser));
  const owes = plan
    .filter((t) => t.from === user!.id || t.to === user!.id)
    .map((t) =>
      t.from === user!.id
        ? { id: t.to, name: nameById.get(t.to) ?? "?", v: -t.amount }   // you owe them
        : { id: t.from, name: nameById.get(t.from) ?? "?", v: t.amount }, // they owe you
    );
  const settleUp = plan.length > 0;

  const list = (arr: CardData[], empty: string) =>
    arr.length ? (
      <div className="flex flex-col gap-3">{arr.map((d) => <MatchCard key={d.contestId} d={d} />)}</div>
    ) : (
      <div className="rounded-card border border-dashed border-[#CBD5E1] p-8 text-center text-[13px] text-muted">{empty}</div>
    );

  return (
    <main className="min-h-screen bg-bg">
      <AutoRefresh seconds={30} />
      <header className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
        <BackLink href="/" />
        <span className="text-[17px] font-extrabold">{league.name}</span>
        <span className="ml-auto"><Avatar label={(user?.user_metadata?.username as string) ?? "you"} size={28} /></span>
      </header>

      <div className="mx-auto max-w-[480px] px-4 py-4">
        <div className="mb-4 flex items-center justify-between rounded-card border border-border bg-surface p-4 shadow-[0_2px_8px_rgba(15,23,42,.04)]">
          <div>
            <div className="text-[11px] text-muted">Your net</div>
            <div className={`font-mono text-2xl font-bold tabular ${myNet > 0 ? "text-win" : myNet < 0 ? "text-loss" : "text-muted"}`}>{inr(myNet)}</div>
          </div>
          <div className="text-right text-[11px] text-muted">{(members ?? []).length} players</div>
        </div>

        <LeagueTabs
          counts={{ Upcoming: groups.upcoming.length, Live: groups.live.length, Done: groups.done.length }}
          upcoming={list(groups.upcoming, "No upcoming contests.")}
          live={list(groups.live, "No live matches right now.")}
          done={list(groups.done, "Nothing settled yet.")}
          dues={
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                {leaderboard.map((m, i) => (
                  <div key={m.id} className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-2.5">
                    <span className="w-4 font-mono text-[13px] text-muted">{i + 1}</span>
                    <Avatar label={m.name} size={26} />
                    <span className="text-[14px] font-semibold">{m.name}{m.id === user!.id ? " (you)" : ""}</span>
                    <span className={`ml-auto font-mono text-[14px] font-bold tabular ${m.net > 0 ? "text-win" : m.net < 0 ? "text-loss" : "text-muted"}`}>{inr(m.net)}</span>
                  </div>
                ))}
              </div>
              {settleUp && owes.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">Settle up</div>
                  {owes.map((o) => (
                    <div key={o.id} className={`flex items-center justify-between rounded-card px-4 py-3 ${o.v < 0 ? "bg-[#FEF2F2]" : "bg-[#F0FDF4]"}`}>
                      <span className="text-[13px] font-semibold">
                        {o.v < 0 ? <>You owe <strong>{o.name}</strong></> : <><strong>{o.name}</strong> owes you</>}
                      </span>
                      <span className={`font-mono text-[14px] font-bold tabular ${o.v < 0 ? "text-loss" : "text-win"}`}>₹{Math.abs(o.v).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>
              )}
              {!settleUp && <p className="text-center text-[12px] text-muted">Dues update as matches settle.</p>}
            </div>
          }
        />
      </div>
    </main>
  );
}
