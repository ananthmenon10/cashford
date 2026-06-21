import "server-only";

// Server loader for the home "Matches" tab (PRD docs/prds/2026-06-21-home-matches-tab-prd.md).
// Aggregates the viewer's contests across ALL their leagues, derives each one's card state (the
// same deriveCardState the league page uses), then groups by fixture via lib/match-feed and
// computes the two server-only extras the client can't: the cross-league live provisional net and
// the "picks due" nudge. Returns a fully serializable MatchesView for the client <MatchesTab/>.

import { deriveCardState, type ContestStatus, type FixtureStatus, type ResultKind } from "./contest-state";
import { settle, type Prediction } from "./settlement";
import { groupMatches, splitByPhase, type FeedEntry, type FeedFixture, type MatchesView } from "./match-feed";
import type { createClient } from "./supabase/server";
import type { createServiceRoleClient } from "./supabase/service";

type RlsClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createServiceRoleClient>;

export async function loadMatchesView(supabase: RlsClient, admin: AdminClient, userId: string): Promise<MatchesView> {
  const nowMs = Date.now();
  const empty: MatchesView = { live: [], upcoming: [], past: [], provisionalByFixture: {}, picksDue: null };

  const { data: leagues } = await supabase.from("leagues").select("id, name, slug");
  const leagueList = leagues ?? [];
  if (leagueList.length === 0) return empty;
  const leagueIds = leagueList.map((l) => l.id);
  const leagueById = new Map(leagueList.map((l) => [l.id, l]));

  const [{ data: memberRows }, { data: contests }, { data: teams }, { data: myPreds }, { data: myResults }] =
    await Promise.all([
      supabase.from("league_members").select("league_id, user_id").in("league_id", leagueIds),
      supabase
        .from("contests")
        .select(
          "id, league_id, status, lock_at, stake_inr, is_knockout, fixture_id, fixtures(round, home_label, away_label, home_team_id, away_team_id, kickoff_at, status, status_detail, ft_home, ft_away, minute, advancer_team_id)",
        )
        .in("league_id", leagueIds),
      supabase.from("teams").select("id, short_name"),
      supabase.from("predictions").select("contest_id, outcome, pred_home, pred_away").eq("user_id", userId),
      supabase.from("contest_results").select("contest_id, result, net_inr").eq("user_id", userId),
    ]);

  const memberCount = new Map<string, number>();
  for (const m of memberRows ?? []) memberCount.set(m.league_id, (memberCount.get(m.league_id) ?? 0) + 1);
  const short = new Map((teams ?? []).map((t) => [t.id, t.short_name as string | null]));
  const predByContest = new Map((myPreds ?? []).map((p) => [p.contest_id, p]));
  const resByContest = new Map((myResults ?? []).map((r) => [r.contest_id, r]));

  const contestRows = contests ?? [];
  const contestIds = contestRows.map((c) => c.id);

  // "X/Y joined" entrant counts via the service-role client: RLS hides others' picks before lock,
  // so a normal read would undercount. We expose only the COUNT here, never the picks (no-peek).
  const { data: predRows } = contestIds.length
    ? await admin.from("predictions").select("contest_id").in("contest_id", contestIds)
    : { data: [] as { contest_id: string }[] };
  const joined = new Map<string, number>();
  for (const p of predRows ?? []) joined.set(p.contest_id, (joined.get(p.contest_id) ?? 0) + 1);

  const entries: FeedEntry[] = [];
  const fixturesById = new Map<string, FeedFixture>();

  for (const c of contestRows) {
    const f = (Array.isArray(c.fixtures) ? c.fixtures[0] : c.fixtures) as any;
    if (!f) continue;
    const mine = predByContest.get(c.id);
    const res = resByContest.get(c.id);
    const advancerSide = f.advancer_team_id ? (f.advancer_team_id === f.home_team_id ? "home" : "away") : null;
    const state = deriveCardState({
      contestStatus: c.status as ContestStatus,
      fixtureStatus: f.status as FixtureStatus,
      lockAtMs: new Date(c.lock_at).getTime(),
      nowMs,
      isKnockout: c.is_knockout,
      homeKnown: !!f.home_team_id,
      awayKnown: !!f.away_team_id,
      hasMyPrediction: !!mine,
      myResult: (res?.result ?? (mine ? null : "not_entered")) as ResultKind | null,
    });
    const league = leagueById.get(c.league_id)!;
    entries.push({
      fixtureId: c.fixture_id,
      contestId: c.id,
      leagueId: c.league_id,
      leagueName: league.name,
      leagueSlug: league.slug,
      state,
      stake: c.stake_inr,
      pick: mine ? { outcome: mine.outcome, predHome: mine.pred_home, predAway: mine.pred_away } : null,
      net: res?.net_inr ?? null,
      joined: joined.get(c.id) ?? 0,
      members: memberCount.get(c.league_id) ?? 0,
    });
    if (!fixturesById.has(c.fixture_id)) {
      fixturesById.set(c.fixture_id, {
        fixtureId: c.fixture_id,
        round: f.round,
        isKnockout: c.is_knockout,
        homeLabel: f.home_label,
        awayLabel: f.away_label,
        homeShort: short.get(f.home_team_id) ?? null,
        awayShort: short.get(f.away_team_id) ?? null,
        kickoffIso: f.kickoff_at,
        kickoffMs: new Date(f.kickoff_at).getTime(),
        ftHome: f.ft_home,
        ftAway: f.ft_away,
        minute: f.minute,
        statusDetail: f.status_detail,
        advancerSide,
      });
    }
  }

  const { live, upcoming, past } = splitByPhase(groupMatches(entries, fixturesById));

  // Cross-league live provisional: for each live fixture, Σ the viewer's settle()-at-current-score
  // net across every league it's live in. Picks are visible post-lock (live ⇒ locked) so a plain
  // RLS read returns all entrants. settle() is pure; same guards as the league page.
  const provisionalByFixture: Record<string, number | null> = {};
  const liveContestIds = entries.filter((e) => e.state === "live").map((e) => e.contestId);
  if (liveContestIds.length) {
    const { data: livePreds } = await supabase
      .from("predictions")
      .select("contest_id, user_id, outcome, pred_home, pred_away")
      .in("contest_id", liveContestIds);
    const byContest = new Map<string, Prediction[]>();
    for (const p of livePreds ?? []) {
      const arr = byContest.get(p.contest_id) ?? [];
      arr.push({ userId: p.user_id, outcome: p.outcome, predHome: p.pred_home, predAway: p.pred_away });
      byContest.set(p.contest_id, arr);
    }
    for (const g of live) {
      let net: number | null = null;
      for (const lg of g.leagues) {
        if (lg.state !== "live" || !lg.pick) continue;
        const preds = byContest.get(lg.contestId) ?? [];
        if (preds.length < 2) continue; // void if <2 entrants — no provisional
        const hh = g.fixture.ftHome ?? 0;
        const aa = g.fixture.ftAway ?? 0;
        const adv = g.fixture.isKnockout ? (hh > aa ? "home" : aa > hh ? "away" : undefined) : undefined;
        if (g.fixture.isKnockout && !adv) continue; // level knockout — too close to call
        const s = settle(preds, { isKnockout: g.fixture.isKnockout, ftHome: hh, ftAway: aa, advancer: adv }, lg.stake);
        const mineNet = s.results.find((r) => r.userId === userId)?.net ?? null;
        if (mineNet != null) net = (net ?? 0) + mineNet;
      }
      provisionalByFixture[g.fixtureId] = net;
    }
  }

  // picksDue (drives the home tab's red attention dot): unpredicted fixtures locking SOON (≤24h) —
  // not the whole-tournament backlog, so the dot means "act now", not "you have 32 games left".
  // lock_at == kickoff_at; `upcoming` is kickoff-ascending so due[0] locks soonest.
  const soonCutoff = nowMs + 24 * 60 * 60 * 1000;
  const due = upcoming.filter((g) => g.needsPick && g.fixture.kickoffMs > nowMs && g.fixture.kickoffMs <= soonCutoff);
  const picksDue = due.length ? { count: due.length, earliestLockIso: due[0].fixture.kickoffIso } : null;

  return { live, upcoming, past: [...past].reverse(), provisionalByFixture, picksDue };
}
