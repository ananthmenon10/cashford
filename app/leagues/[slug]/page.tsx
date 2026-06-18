import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deriveCardState, tabForState, type ContestStatus, type FixtureStatus, type ResultKind } from "@/lib/contest-state";
import { MatchCard, type CardData } from "@/components/MatchCard";
import { LeagueTabs } from "@/components/LeagueTabs";
import { Avatar, inr } from "@/components/ui";

export default async function LeaguePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: league } = await supabase.from("leagues").select("id, name, slug").eq("slug", slug).single();
  if (!league) notFound(); // not a member (RLS) or bad slug

  const [{ data: contests }, { data: teams }, { data: myPreds }, { data: myResults }, { data: members }] =
    await Promise.all([
      supabase.from("contests")
        .select("id, status, lock_at, stake_inr, is_knockout, fixtures(round, home_label, away_label, home_team_id, away_team_id, kickoff_at, status, status_detail, ft_home, ft_away, minute, advancer_team_id)")
        .eq("league_id", league.id),
      supabase.from("teams").select("id, short_name"),
      supabase.from("predictions").select("contest_id, outcome, pred_home, pred_away").eq("user_id", user!.id),
      supabase.from("contest_results").select("contest_id, result, net_inr").eq("user_id", user!.id),
      supabase.from("profiles").select("id, display_name, username")
        .in("id", (await supabase.from("league_members").select("user_id").eq("league_id", league.id)).data?.map((m) => m.user_id) ?? []),
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
        ftHome: f.ft_home, ftAway: f.ft_away, minute: f.minute,
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

  // Your net in this league = Σ contest_results.net_inr
  const myNet = (myResults ?? []).reduce((t, r) => t + (r.net_inr ?? 0), 0);

  const list = (arr: CardData[], empty: string) =>
    arr.length ? (
      <div className="flex flex-col gap-3">{arr.map((d) => <MatchCard key={d.contestId} d={d} />)}</div>
    ) : (
      <div className="rounded-card border border-dashed border-[#CBD5E1] p-8 text-center text-[13px] text-muted">{empty}</div>
    );

  return (
    <main className="min-h-screen bg-bg">
      <header className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
        <Link href="/" className="text-lg text-muted">‹</Link>
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
            <div className="flex flex-col gap-2">
              {(members ?? []).map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
                  <Avatar label={m.display_name || m.username} size={26} />
                  <span className="text-[14px] font-semibold">{m.display_name || m.username}</span>
                  <span className="ml-auto font-mono text-[14px] font-bold text-muted tabular">{inr(0)}</span>
                </div>
              ))}
              <p className="mt-2 text-center text-[12px] text-muted">Dues update as matches settle.</p>
            </div>
          }
        />
      </div>
    </main>
  );
}
