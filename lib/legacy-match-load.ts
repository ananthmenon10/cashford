import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveCardState,
  type CardState,
  type ContestStatus,
  type FixtureStatus,
  type ResultKind,
} from "./contest-state";
import { isEligible, RENDER_MARGIN_MS, type OtherLeague, type PickShape } from "./cross-league";
import { INSIGHTS_WINDOW_MS, mapInsightsView, refreshInsights, type InsightsView } from "./espn-insights";
import { ROUND_LABEL } from "./contest-state";
import type { Outcome } from "./settlement";
import { type PlayerPick } from "./match-board";
import type { RevealRow } from "../components/RevealGrid";

type CashfordClient = SupabaseClient<any, "cashford", any>;

function fail(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

type InsightWarm = { fixtureId: string; externalId: number; espnSlug: string };

export type LegacyMatchPageLoad = {
  c: any;
  f: any;
  homeShort: string | null;
  awayShort: string | null;
  highlightTeamIds: string[];
  mine: any;
  myRes: any;
  now: number;
  revealed: boolean;
  state: CardState;
  isOpen: boolean;
  roundTxt: string;
  roundLabel: string;
  advancerLabel: string | null;
  otherLeagues: OtherLeague[];
  prefillFrom: (PickShape & { leagueName: string }) | null;
  insightsView: InsightsView | null;
  insightWarm: InsightWarm | null;
  rows: RevealRow[];
  players: PlayerPick[];
};

/**
 * Read path for app/leagues/[slug]/m/[id]/page.tsx. The page keeps its live-score and insight
 * warmers, but the smoke pass calls this with allowInsightWrites=false so no cache row can be
 * created while checking the page's PostgREST reads.
 */
export async function loadLegacyMatchPage(
  session: CashfordClient,
  admin: CashfordClient,
  userId: string,
  contestId: string,
  options: { allowInsightWrites?: boolean } = {},
): Promise<LegacyMatchPageLoad | null> {
  const allowInsightWrites = options.allowInsightWrites ?? true;
  const contestQuery = await session
    .from("contests")
    .select(
      "id, league_id, fixture_id, status, void_reason, lock_at, stake_inr, is_knockout, fixtures(external_id, round, group_label, home_label, away_label, home_team_id, away_team_id, kickoff_at, status, status_detail, ft_home, ft_away, minute, venue, advancer_team_id, competitions(espn_slug))",
    )
    .eq("id", contestId)
    .single();
  fail(contestQuery.error, "legacy-match-contest");
  const c = contestQuery.data;
  if (!c) return null;
  const f = one<any>(c.fixtures);
  if (!f) return null;

  const teamsQuery = await session
    .from("teams")
    .select("id, short_name, external_id");
  fail(teamsQuery.error, "legacy-match-teams");
  const short = new Map(
    (teamsQuery.data ?? []).map((t: any) => [t.id, t.short_name as string | null]),
  );
  const extId = new Map(
    (teamsQuery.data ?? []).map((t: any) => [t.id, t.external_id as number | null]),
  );
  const homeShort = short.get(f.home_team_id ?? "") ?? null;
  const awayShort = short.get(f.away_team_id ?? "") ?? null;
  const highlightTeamIds = [f.home_team_id, f.away_team_id]
    .map((teamId) => (teamId ? extId.get(teamId) : null))
    .filter((value): value is number => value != null)
    .map(String);

  const [mineQuery, resultQuery] = await Promise.all([
    session
      .from("predictions")
      .select("outcome, pred_home, pred_away")
      .eq("contest_id", contestId)
      .eq("user_id", userId)
      .maybeSingle(),
    session
      .from("contest_results")
      .select("result, net_inr")
      .eq("contest_id", contestId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  fail(mineQuery.error, "legacy-match-my-prediction");
  fail(resultQuery.error, "legacy-match-my-result");
  const mine = mineQuery.data;
  const myRes = resultQuery.data;

  const now = Date.now();
  const revealed = c.status !== "open" || new Date(c.lock_at).getTime() <= now;
  const state = deriveCardState({
    contestStatus: c.status as ContestStatus,
    fixtureStatus: f.status as FixtureStatus,
    lockAtMs: new Date(c.lock_at).getTime(),
    nowMs: now,
    isKnockout: c.is_knockout,
    homeKnown: !!f.home_team_id,
    awayKnown: !!f.away_team_id,
    hasMyPrediction: !!mine,
    myResult: (myRes?.result ?? (mine ? null : "not_entered")) as ResultKind | null,
  });
  const isOpen = state === "open_nopick" || state === "open_picked";
  const roundTxt = f.round === "group" ? "Group stage" : ROUND_LABEL[f.round] ?? f.round;
  const roundLabel =
    f.round === "group"
      ? f.group_label
        ? `Group ${f.group_label}`
        : "Group stage"
      : ROUND_LABEL[f.round] ?? f.round;
  const advancerLabel = f.advancer_team_id
    ? f.advancer_team_id === f.home_team_id
      ? f.home_label
      : f.away_label
    : null;

  let otherLeagues: OtherLeague[] = [];
  let prefillFrom: (PickShape & { leagueName: string }) | null = null;
  let insightsView: InsightsView | null = null;
  let insightWarm: InsightWarm | null = null;
  if (isOpen) {
    const siblingsQuery = await session
      .from("contests")
      .select("id, status, lock_at, leagues(name)")
      .eq("fixture_id", c.fixture_id)
      .neq("id", c.id);
    fail(siblingsQuery.error, "legacy-match-siblings");
    const siblings = siblingsQuery.data ?? [];
    const siblingIds = siblings.map((s: any) => s.id);
    const siblingPredictions = siblingIds.length
      ? await session
          .from("predictions")
          .select("contest_id, outcome, pred_home, pred_away, updated_at")
          .in("contest_id", siblingIds)
          .eq("user_id", userId)
      : { data: [], error: null };
    fail(siblingPredictions.error, "legacy-match-sibling-predictions");
    const sibPreds = siblingPredictions.data ?? [];
    const pickBy = new Map(sibPreds.map((p: any) => [p.contest_id, p]));
    const leagueName = (s: { leagues: unknown }) =>
      (one<any>(s.leagues)?.name as string | undefined) ?? "League";
    otherLeagues = siblings.map((s: any) => {
      const p = pickBy.get(s.id);
      return {
        contestId: s.id,
        leagueName: leagueName(s),
        eligible: isEligible(
          s.status,
          new Date(s.lock_at).getTime(),
          now,
          RENDER_MARGIN_MS,
        ),
        existingPick: p
          ? { outcome: p.outcome as PickShape["outcome"], predHome: p.pred_home, predAway: p.pred_away }
          : null,
      };
    });
    const latest = [...sibPreds].sort(
      (a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )[0];
    if (latest) {
      const source = siblings.find((s: any) => s.id === latest.contest_id);
      prefillFrom = {
        leagueName: source ? leagueName(source) : "other league",
        outcome: latest.outcome as PickShape["outcome"],
        predHome: latest.pred_home,
        predAway: latest.pred_away,
      };
    }

    const kickoffMs = new Date(f.kickoff_at).getTime();
    const inWindow = kickoffMs > now && kickoffMs - now <= INSIGHTS_WINDOW_MS;
    const cachedQuery = await session
      .from("fixture_insights")
      .select("*")
      .eq("fixture_id", c.fixture_id)
      .maybeSingle();
    fail(cachedQuery.error, "legacy-match-insights");
    let row: any = cachedQuery.data;
    const competition = one<any>(f.competitions);
    const espnSlug: string | null = competition?.espn_slug ?? null;
    if (!row && allowInsightWrites && inWindow && f.external_id && espnSlug) {
      try {
        const refreshed = await refreshInsights(
          admin as any,
          { id: c.fixture_id, external_id: f.external_id, espn_slug: espnSlug },
          { ttlMs: 0, signal: AbortSignal.timeout(2000) },
        );
        row = refreshed.row ?? null;
      } catch {
        // The page has always treated an unavailable provider as an empty insights panel.
      }
    }
    insightsView = mapInsightsView(row);
    if (allowInsightWrites && inWindow && f.external_id && espnSlug) {
      insightWarm = {
        fixtureId: c.fixture_id,
        externalId: f.external_id,
        espnSlug,
      };
    }
  }

  let rows: RevealRow[] = [];
  let players: PlayerPick[] = [];
  if (revealed) {
    const memberRowsQuery = await session
      .from("league_members")
      .select("user_id")
      .eq("league_id", c.league_id);
    fail(memberRowsQuery.error, "legacy-match-members");
    const memberIds = (memberRowsQuery.data ?? []).map((m: any) => m.user_id);
    const [predictionsQuery, resultsQuery, profilesQuery] = await Promise.all([
      session
        .from("predictions")
        .select("user_id, outcome, pred_home, pred_away")
        .eq("contest_id", contestId),
      session
        .from("contest_results")
        .select("user_id, result, net_inr")
        .eq("contest_id", contestId),
      session
        .from("profiles")
        .select("id, display_name, username")
        .in("id", memberIds),
    ]);
    fail(predictionsQuery.error, "legacy-match-revealed-predictions");
    fail(resultsQuery.error, "legacy-match-revealed-results");
    fail(profilesQuery.error, "legacy-match-revealed-profiles");
    const preds = predictionsQuery.data ?? [];
    const results = resultsQuery.data ?? [];
    const profiles = profilesQuery.data ?? [];
    const predBy = new Map(preds.map((p: any) => [p.user_id, p]));
    const resBy = new Map(results.map((r: any) => [r.user_id, r]));
    const nameById = new Map(
      profiles.map((pr: any) => [pr.id, pr.display_name || pr.username]),
    );
    players = [...preds]
      .sort((x: any, y: any) => (x.user_id < y.user_id ? -1 : 1))
      .map((p: any, i) => ({
        id: `p${String(i).padStart(2, "0")}`,
        name: nameById.get(p.user_id) ?? "Player",
        isMe: p.user_id === userId,
        outcome: p.outcome as Outcome,
        predHome: p.pred_home,
        predAway: p.pred_away,
      }));
    const pickLabel = (outcome: string) =>
      outcome === "home" ? homeShort || "Home" : outcome === "away" ? awayShort || "Away" : "Draw";
    rows = profiles
      .map((pr: any) => {
        const p = predBy.get(pr.id);
        const r = resBy.get(pr.id);
        if (!p) {
          return {
            userId: pr.id,
            name: pr.display_name || pr.username,
            isMe: pr.id === userId,
            pickLabel: "—",
            predHome: 0,
            predAway: 0,
            result: "not_entered" as const,
          };
        }
        return {
          userId: pr.id,
          name: pr.display_name || pr.username,
          isMe: pr.id === userId,
          pickLabel: pickLabel(p.outcome),
          predHome: p.pred_home,
          predAway: p.pred_away,
          result: (r?.result ?? null) as RevealRow["result"],
          net: r?.net_inr ?? null,
          winner: r?.result === "win",
        };
      })
      .sort((a, b) => (a.pickLabel === "—" ? 1 : 0) - (b.pickLabel === "—" ? 1 : 0));
  }

  return {
    c,
    f,
    homeShort,
    awayShort,
    highlightTeamIds,
    mine,
    myRes,
    now,
    revealed,
    state,
    isOpen,
    roundTxt,
    roundLabel,
    advancerLabel,
    otherLeagues,
    prefillFrom,
    insightsView,
    insightWarm,
    rows,
    players,
  };
}
