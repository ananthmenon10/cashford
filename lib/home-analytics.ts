import "server-only";

// Server loader for the home "Analytics" tab (PRD docs/prds/2026-06-21-home-analytics-tab-prd.md).
// Builds the GLOBAL view (the viewer, across all their leagues) + a PER-LEAGUE drill-down (adds
// rivalry: sharpest board, head-to-head) for each league. All cross-member stats use only FINISHED
// fixtures (post-lock → picks are visible; no-peek preserved). Pure maths lives in lib/analytics.

import {
  accuracy, currentStreak, potRecord, bestResult, luckyTeam,
  calledUpsets, favouritesWonPct,
  type Entry, type ModelProbs, type ResultInfo, type AnalyticsView, type LeagueAnalytics, type Outcome,
} from "./analytics";
import type { createClient } from "./supabase/server";

type RlsClient = Awaited<ReturnType<typeof createClient>>;

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export async function loadAnalyticsView(supabase: RlsClient, userId: string): Promise<AnalyticsView> {
  const emptyAcc = accuracy([]);
  const emptyGlobal = {
    net: 0, acc: emptyAcc, pot: { entered: 0, won: 0 }, streak: 0, daily: [],
    best: null, lucky: null, favouritesWonPct: null, calledUpsets: 0,
  };

  const { data: leagues } = await supabase.from("leagues").select("id, name, slug").order("name");
  const leagueList = leagues ?? [];
  if (!leagueList.length) return { global: emptyGlobal, leagues: [] };
  const leagueIds = leagueList.map((l) => l.id);

  const [{ data: contests }, { data: memberRows }, { data: insightRows }] = await Promise.all([
    supabase.from("contests")
      .select("id, league_id, is_knockout, fixture_id, fixtures(home_label, away_label, home_team_id, kickoff_at, ft_home, ft_away, advancer_team_id)")
      .in("league_id", leagueIds),
    supabase.from("league_members").select("league_id, user_id").in("league_id", leagueIds),
    supabase.from("fixture_insights").select("fixture_id, p_home, p_draw, p_away"),
  ]);

  const contestRows = contests ?? [];
  const contestIds = contestRows.map((c) => c.id);

  const model = new Map<string, ModelProbs>();
  for (const r of insightRows ?? []) {
    const pHome = num(r.p_home), pDraw = num(r.p_draw), pAway = num(r.p_away);
    if (pHome != null && pDraw != null && pAway != null) model.set(r.fixture_id, { pHome, pDraw, pAway });
  }

  // Member names.
  const memberIds = [...new Set((memberRows ?? []).map((m) => m.user_id))];
  const { data: profiles } = memberIds.length
    ? await supabase.from("profiles").select("id, display_name, username").in("id", memberIds)
    : { data: [] as { id: string; display_name: string | null; username: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name || p.username || "?"]));

  // Everyone's predictions + results for these contests (RLS: finished ⇒ post-lock ⇒ visible), and
  // transfers in these leagues — one query each, then bucketed in memory.
  const [{ data: allPreds }, { data: allResults }, { data: transfers }] = await Promise.all([
    contestIds.length ? supabase.from("predictions").select("contest_id, user_id, outcome, pred_home, pred_away").in("contest_id", contestIds) : Promise.resolve({ data: [] as any[] }),
    contestIds.length ? supabase.from("contest_results").select("contest_id, user_id, net_inr").in("contest_id", contestIds) : Promise.resolve({ data: [] as any[] }),
    supabase.from("transfers").select("league_id, from_user_id, to_user_id, amount_inr").eq("reversed", false).in("league_id", leagueIds),
  ]);

  // Index a contest → its fixture facts + league, and only keep FINISHED (gradeable) ones.
  type CInfo = { leagueId: string; isKnockout: boolean; fixtureId: string; result: ResultInfo; kickoffMs: number; kickoffAt: string; homeLabel: string; awayLabel: string };
  const cinfo = new Map<string, CInfo>();
  for (const c of contestRows) {
    const f = (Array.isArray(c.fixtures) ? c.fixtures[0] : c.fixtures) as any;
    if (!f || f.ft_home == null || f.ft_away == null) continue; // not finished → not gradeable
    const advancer: Outcome | null = f.advancer_team_id ? (f.advancer_team_id === f.home_team_id ? "home" : "away") : null;
    const ko = new Date(f.kickoff_at);
    cinfo.set(c.id, {
      leagueId: c.league_id, isKnockout: c.is_knockout, fixtureId: c.fixture_id,
      result: { ftHome: f.ft_home, ftAway: f.ft_away, isKnockout: c.is_knockout, advancer },
      kickoffMs: ko.getTime(), kickoffAt: f.kickoff_at, homeLabel: f.home_label, awayLabel: f.away_label,
    });
  }

  const slugByLeague = new Map(leagueList.map((l) => [l.id, l.slug]));
  const netByContestUser = new Map<string, number>(); // `${contestId}:${userId}` → net
  for (const r of allResults ?? []) netByContestUser.set(`${r.contest_id}:${r.user_id}`, r.net_inr ?? 0);

  // Build a graded Entry from a (contest, prediction) pair.
  const toEntry = (contestId: string, p: { outcome: Outcome; pred_home: number; pred_away: number }, uid: string): Entry | null => {
    const ci = cinfo.get(contestId);
    if (!ci) return null;
    const k = `${contestId}:${uid}`;
    return {
      outcome: p.outcome, predHome: p.pred_home, predAway: p.pred_away,
      ftHome: ci.result.ftHome, ftAway: ci.result.ftAway, isKnockout: ci.isKnockout, advancer: ci.result.advancer,
      net: netByContestUser.has(k) ? netByContestUser.get(k)! : null,
      kickoffMs: ci.kickoffMs, kickoffAt: ci.kickoffAt, homeLabel: ci.homeLabel, awayLabel: ci.awayLabel,
      model: model.get(ci.fixtureId) ?? null, slug: slugByLeague.get(ci.leagueId), contestId,
    };
  };

  // ── GLOBAL: the viewer across all leagues (per-contest entries) ──────────────────────────────
  const myEntries: Entry[] = [];
  const predsByContest = new Map<string, { user_id: string; outcome: Outcome; pred_home: number; pred_away: number }[]>();
  for (const p of allPreds ?? []) {
    const arr = predsByContest.get(p.contest_id) ?? [];
    arr.push(p);
    predsByContest.set(p.contest_id, arr);
    if (p.user_id === userId) {
      const e = toEntry(p.contest_id, p, userId);
      if (e) myEntries.push(e);
    }
  }

  const myNetTotal = (allResults ?? []).filter((r) => r.user_id === userId).reduce((t, r) => t + (r.net_inr ?? 0), 0);
  const best = bestResult(myEntries);
  const lucky = luckyTeam(myEntries);

  // Tournament-wide favourites: each finished fixture (deduped) that has model odds.
  const favRows: { model: ModelProbs; result: ResultInfo }[] = [];
  const seenFx = new Set<string>();
  for (const ci of cinfo.values()) {
    if (seenFx.has(ci.fixtureId)) continue;
    seenFx.add(ci.fixtureId);
    const m = model.get(ci.fixtureId);
    if (m) favRows.push({ model: m, result: ci.result });
  }

  const global = {
    net: myNetTotal,
    acc: accuracy(myEntries),
    pot: potRecord(myEntries),
    streak: currentStreak(myEntries),
    daily: myEntries.flatMap((entry) =>
      entry.net == null || !entry.kickoffAt
        ? []
        : [{ kickoffAt: entry.kickoffAt, net: entry.net }],
    ),
    best: best ? { net: best.net ?? 0, label: `${best.homeLabel} ${best.ftHome}–${best.ftAway} ${best.awayLabel}`, slug: best.slug ?? "", contestId: best.contestId ?? "" } : null,
    lucky,
    favouritesWonPct: favouritesWonPct(favRows),
    calledUpsets: calledUpsets(myEntries),
  };

  // ── PER-LEAGUE drill-down ─────────────────────────────────────────────────────────────────────
  const membersByLeague = new Map<string, string[]>();
  for (const m of memberRows ?? []) {
    const arr = membersByLeague.get(m.league_id) ?? [];
    arr.push(m.user_id);
    membersByLeague.set(m.league_id, arr);
  }

  const leaguesOut: LeagueAnalytics[] = leagueList.map((lg) => {
    const members = membersByLeague.get(lg.id) ?? [];
    const leagueContestIds = contestRows.filter((c) => c.league_id === lg.id).map((c) => c.id);
    const leagueContestSet = new Set(leagueContestIds);

    // per-member entries (their picks on this league's finished contests) → accuracy
    const entriesByUser = new Map<string, Entry[]>();
    for (const cid of leagueContestIds) {
      for (const p of predsByContest.get(cid) ?? []) {
        const e = toEntry(cid, p, p.user_id);
        if (!e) continue;
        const arr = entriesByUser.get(p.user_id) ?? [];
        arr.push(e);
        entriesByUser.set(p.user_id, arr);
      }
    }

    // net per member in this league → rank
    const netByUser = new Map<string, number>(members.map((id) => [id, 0]));
    for (const r of allResults ?? []) {
      if (!leagueContestSet.has(r.contest_id)) continue;
      netByUser.set(r.user_id, (netByUser.get(r.user_id) ?? 0) + (r.net_inr ?? 0));
    }
    const myNet = netByUser.get(userId) ?? 0;
    const rank = [...netByUser.values()].filter((n) => n > myNet).length + 1;

    // money flow vs the viewer (＋ = the member has paid the viewer more than vice-versa)
    const flow = new Map<string, number>();
    for (const t of transfers ?? []) {
      if (t.league_id !== lg.id) continue;
      if (t.to_user_id === userId) flow.set(t.from_user_id, (flow.get(t.from_user_id) ?? 0) + (t.amount_inr ?? 0));
      else if (t.from_user_id === userId) flow.set(t.to_user_id, (flow.get(t.to_user_id) ?? 0) - (t.amount_inr ?? 0));
    }

    const accFor = (uid: string) => accuracy(entriesByUser.get(uid) ?? []);
    const sharpest = members
      .map((uid) => { const a = accFor(uid); return { userId: uid, name: nameById.get(uid) ?? "?", isMe: uid === userId, accuracyPct: a.correctPct, graded: a.graded }; })
      .sort((a, b) => (b.accuracyPct ?? -1) - (a.accuracyPct ?? -1) || b.graded - a.graded || (a.name < b.name ? -1 : 1));
    const rivals = members
      .filter((uid) => uid !== userId)
      .map((uid) => { const a = accFor(uid); return { userId: uid, name: nameById.get(uid) ?? "?", accuracyPct: a.correctPct, graded: a.graded, moneyFlow: flow.get(uid) ?? 0 }; })
      .sort((a, b) => (a.name < b.name ? -1 : 1));

    return {
      leagueId: lg.id, leagueName: lg.name, slug: lg.slug,
      net: myNet, rank, members: members.length,
      acc: accFor(userId),
      sharpest, rivals,
    };
  });

  return { global, leagues: leaguesOut };
}
