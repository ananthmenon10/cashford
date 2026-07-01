import "server-only";

// Server loader for the Knockout Circle. Fetches the WC knockout fixtures + teams,
// binds them to radial slots (lib/knockout.bindBracket — pure, verified), then
// assembles a serializable KnockoutView the client ring renders. Live results fill a
// slot only when its match is final (advancer set); everything else is TBD/upcoming.

import { bindBracket, key, GEO, CIRCLE_MATCHES, score, type KnockoutFixture, type SlotKey, type Picks, type Results } from "./knockout";
import type { createClient } from "./supabase/server";
import type { createServiceRoleClient } from "./supabase/service";

type RlsClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createServiceRoleClient>;

const TOURNAMENT = "wc2026";

export interface KnockoutTeam {
  id: string;
  code: string; // 3-letter short name (fallback label)
  name: string;
  flagUrl: string | null;
}

export interface KnockoutSlotView {
  slot: SlotKey;
  ring: number;
  idx: number;
  team: KnockoutTeam | null; // actual occupant in LIVE mode (advancer/entrant), null = TBD
  finished: boolean; // this slot's match is final (rings 1..5)
  live: boolean; // this slot's match is in progress
  kickoffMs: number | null;
}

export interface KnockoutView {
  slots: KnockoutSlotView[]; // placed nodes only (rings 0..5)
  decided: number; // finished circle matches
  total: number; // 31
  results: Record<SlotKey, string | null>; // slot → advancer teamId (rings 1..5), for scoring/autoPicks
  myPicks: Record<SlotKey, string>; // viewer's picks (rings 1..5), slot → teamId
  field: Record<number, string>; // ring-0 index → entrant teamId (placed entrants)
  slotFixtureId: Record<SlotKey, string>; // slot (rings 1..5) → fixture UUID (for pick writes)
  teams: Record<string, KnockoutTeam>; // teamId → team
  locked: boolean; // viewer's bracket locked?
  shareToken: string | null; // viewer's share token (once locked)
  nextKickoffIso: string | null; // earliest upcoming circle match (for Live panel context)
}

const LIVE_STATUSES = new Set(["in", "in_progress", "live", "ht", "halftime"]);

// ---- Per-league bracket-accuracy leaderboard ---------------------------------
export interface LeaderboardRow {
  userId: string;
  name: string;
  correct: number;
  decided: number; // decided matches this member actually predicted
  isYou: boolean;
}
export interface LeagueLeaderboard {
  leagueId: string;
  name: string;
  slug: string;
  rows: LeaderboardRow[];
}

/**
 * Bracket-accuracy board per league the viewer belongs to. One bulk query per table
 * (no N+1); RLS restricts picks to the viewer's own + leaguemates' REVEALED rows, and
 * score() only counts DECIDED matches — so no undecided pick is ever exposed. Ranked by
 * correct count, then by decided (rewards predicting more), then name.
 */
export async function loadKnockoutLeaderboards(supabase: RlsClient, userId: string, results: Results): Promise<LeagueLeaderboard[]> {
  const [{ data: leagues }, { data: members }] = await Promise.all([
    supabase.from("leagues").select("id, name, slug"),
    supabase.from("league_members").select("league_id, user_id"),
  ]);
  const memberIds = [...new Set((members ?? []).map((m) => m.user_id as string))];
  if (memberIds.length === 0) return [];
  const [{ data: profiles }, { data: picks }] = await Promise.all([
    supabase.from("profiles").select("id, username").in("id", memberIds),
    supabase.from("knockout_predictions").select("user_id, slot_key, predicted_team_id").in("user_id", memberIds).eq("tournament_id", TOURNAMENT),
  ]);

  const byUser = new Map<string, Picks>();
  for (const p of picks ?? []) {
    const m = byUser.get(p.user_id as string) ?? {};
    m[p.slot_key as string] = p.predicted_team_id as string;
    byUser.set(p.user_id as string, m);
  }
  const nameOf = new Map((profiles ?? []).map((p) => [p.id as string, (p.username as string) ?? "?"]));
  const byLeague = new Map<string, string[]>();
  for (const m of members ?? []) {
    const a = byLeague.get(m.league_id as string) ?? [];
    a.push(m.user_id as string);
    byLeague.set(m.league_id as string, a);
  }

  return (leagues ?? []).map((lg) => ({
    leagueId: lg.id as string,
    name: lg.name as string,
    slug: lg.slug as string,
    rows: (byLeague.get(lg.id as string) ?? [])
      .map((uid) => {
        const sc = score(byUser.get(uid) ?? {}, results);
        return { userId: uid, name: nameOf.get(uid) ?? "?", correct: sc.correct, decided: sc.decided, isYou: uid === userId };
      })
      .sort((a, b) => b.correct - a.correct || b.decided - a.decided || a.name.localeCompare(b.name)),
  }));
}

export async function loadKnockoutView(supabase: RlsClient, userId: string | null): Promise<KnockoutView> {
  const [{ data: fixtureRows }, { data: teamRows }] = await Promise.all([
    supabase
      .from("fixtures")
      .select("id, external_id, round, home_team_id, away_team_id, home_label, away_label, advancer_team_id, kickoff_at, status")
      .eq("is_knockout", true),
    supabase.from("teams").select("id, short_name, name, flag_url"),
  ]);

  const teams: Record<string, KnockoutTeam> = {};
  for (const t of teamRows ?? []) {
    teams[t.id] = { id: t.id, code: (t.short_name as string) ?? "?", name: (t.name as string) ?? "", flagUrl: (t.flag_url as string) ?? null };
  }

  const fixtures: KnockoutFixture[] = (fixtureRows ?? []).map((f) => ({
    externalId: f.external_id as number,
    round: f.round as KnockoutFixture["round"],
    homeTeamId: f.home_team_id as string | null,
    awayTeamId: f.away_team_id as string | null,
    homeLabel: f.home_label as string | null,
    awayLabel: f.away_label as string | null,
    advancerTeamId: f.advancer_team_id as string | null,
  }));
  const fxByExt = new Map(fixtures.map((f) => [f.externalId, f]));
  const rawByExt = new Map((fixtureRows ?? []).map((f) => [f.external_id as number, f]));

  const { slotFixtureExternalId, ring0TeamId } = bindBracket(fixtures);
  const idByExt = new Map((fixtureRows ?? []).map((f) => [f.external_id as number, f.id as string]));
  const slotFixtureId: Record<SlotKey, string> = {};
  for (const [slot, ext] of Object.entries(slotFixtureExternalId)) {
    const id = idByExt.get(ext);
    if (id) slotFixtureId[slot] = id;
  }

  const results: Record<SlotKey, string | null> = {};
  const slots: KnockoutSlotView[] = [];
  let decided = 0;
  let nextKickoffMs = Infinity;
  const nowMs = Date.now();

  // ring 0 — entrants (placed only where their R32 slot resolved)
  for (let idx = 0; idx < GEO.counts[0]; idx++) {
    const teamId = ring0TeamId[idx];
    if (!teamId) continue;
    slots.push({ slot: key(0, idx), ring: 0, idx, team: teams[teamId] ?? null, finished: false, live: false, kickoffMs: null });
  }

  // rings 1..5 — match winners
  for (let ring = 1; ring <= 5; ring++) {
    for (let idx = 0; idx < GEO.counts[ring]; idx++) {
      const k = key(ring, idx);
      const ext = slotFixtureExternalId[k];
      if (ext == null) continue; // pending — render TBD
      const fx = fxByExt.get(ext);
      const raw = rawByExt.get(ext);
      const advancer = fx?.advancerTeamId ?? null;
      const finished = advancer != null;
      const kickoffIso = raw?.kickoff_at as string | undefined;
      const kickoffMs = kickoffIso ? new Date(kickoffIso).getTime() : null;
      const live = !finished && LIVE_STATUSES.has(String(raw?.status ?? "").toLowerCase());
      results[k] = advancer;
      if (finished) decided++;
      if (kickoffMs != null && !finished && kickoffMs > nowMs) nextKickoffMs = Math.min(nextKickoffMs, kickoffMs);
      slots.push({ slot: k, ring, idx, team: advancer ? (teams[advancer] ?? null) : null, finished, live, kickoffMs });
    }
  }

  // viewer's own picks + lock state (RLS: own rows only)
  const myPicks: Record<SlotKey, string> = {};
  let locked = false;
  let shareToken: string | null = null;
  if (userId) {
    const [{ data: preds }, { data: bracket }] = await Promise.all([
      supabase.from("knockout_predictions").select("slot_key, predicted_team_id").eq("user_id", userId).eq("tournament_id", TOURNAMENT),
      supabase.from("knockout_brackets").select("locked_at, share_token").eq("user_id", userId).eq("tournament_id", TOURNAMENT).maybeSingle(),
    ]);
    for (const p of preds ?? []) myPicks[p.slot_key as string] = p.predicted_team_id as string;
    locked = !!bracket?.locked_at;
    shareToken = (bracket?.share_token as string) ?? null;
  }

  return {
    slots,
    decided,
    total: CIRCLE_MATCHES,
    results,
    myPicks,
    field: ring0TeamId,
    slotFixtureId,
    teams,
    locked,
    shareToken,
    nextKickoffIso: nextKickoffMs === Infinity ? null : new Date(nextKickoffMs).toISOString(),
  };
}
