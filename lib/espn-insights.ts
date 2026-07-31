// ESPN match-insights fetch/parse + cache refresh (plan 2026-06-20-003).
// One keyless `summary` call per fixture returns odds, last-5 form, head-to-head and the (already
// group-scoped) standings table. We parse it into normalised shapes, run the Poisson model
// (lib/odds-model.ts), and upsert a row into cashford.fixture_insights. The predict screen reads
// that row via mapInsightsView() (which coerces Supabase's string numerics back to numbers).
//
// Anchored to the ESPN event id we already store as fixtures.external_id — no extra mapping.
// Mirrors lib/espn.ts conventions: keyless fetch, defensive try/catch, service-role client.
// (No `server-only` import here: the service client is referenced as a type only, and this module
// is imported solely by server files; `server-only` lives on service.ts and would break vitest.)
import { modelFromOdds, type ScoreProb } from "./odds-model";

type Admin = ReturnType<typeof import("./supabase/service").createServiceRoleClient>;

const SUMMARY = (slug: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary`;
export const INSIGHTS_TTL_MS = 3 * 3600e3; // odds move on hours — 3h refresh is ample
export const INSIGHTS_WINDOW_MS = 5 * 24 * 3600e3; // odds appear ≲ ~5 days before kickoff
const POLL_GRACE_MS = 30 * 60e3; // also warm fixtures that just kicked off but are still scheduled
const POLL_CONCURRENCY = 3; // cap simultaneous ESPN calls from the cron batch
const FETCH_TIMEOUT_MS = 2000; // bound every ESPN call (honours the page's cold-miss budget)

// ---- parsed shapes ------------------------------------------------------------------------

export interface ParsedOdds {
  mlHome: number;
  mlDraw: number;
  mlAway: number;
  totalLine: number | null;
  overOdds: number | null;
  underOdds: number | null;
  provider: string | null;
}
export interface FormGame {
  result: "W" | "L" | "D" | null;
  score: string | null;
  opponent: string | null;
  date: string | null;
}
export interface H2HGameRow {
  date: string | null;
  competition: string | null;
  homeScore: number; // oriented to the CURRENT fixture's home team
  awayScore: number;
  result: "W" | "D" | "L"; // from the current home team's POV
}
export interface H2HData {
  tally: { w: number; d: number; l: number };
  games: H2HGameRow[];
}
export interface StandingsRow {
  team: string | null;
  id: string | null;
  gp: number | null;
  w: number | null;
  d: number | null;
  l: number | null;
  gd: number | null;
  pts: number | null;
  rank: number | null;
}
export interface StandingsGroup {
  rows: StandingsRow[];
}

// Pull a number out of an ESPN odds/stat string ("-195", "+370", "o2.5", "+6") or a raw number.
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Current fixture's home/away ESPN team ids, from the summary header competitors.
function homeAwayEspnIds(summary: any): { home: string | null; away: string | null } {
  const cs = summary?.header?.competitions?.[0]?.competitors ?? [];
  const idFor = (ha: string) => {
    const c = cs.find((x: any) => x.homeAway === ha);
    const id = c?.team?.id ?? c?.id;
    return id != null ? String(id) : null;
  };
  return { home: idFor("home"), away: idFor("away") };
}

// Odds: modern pickcenter[] first, then legacy odds[]. Returns null if neither gives a 3-way market.
export function parseOdds(summary: any): ParsedOdds | null {
  const pc = summary?.pickcenter?.[0];
  if (pc?.moneyline) {
    const ml = pc.moneyline;
    const mlHome = num(ml.home?.close?.odds);
    const mlDraw = num(ml.draw?.close?.odds);
    const mlAway = num(ml.away?.close?.odds);
    if (mlHome != null && mlDraw != null && mlAway != null) {
      return {
        mlHome,
        mlDraw,
        mlAway,
        totalLine: num(pc.total?.over?.close?.line),
        overOdds: num(pc.total?.over?.close?.odds),
        underOdds: num(pc.total?.under?.close?.odds),
        provider: pc.provider?.name ?? null,
      };
    }
  }
  const od = summary?.odds?.[0];
  if (od) {
    const mlHome = num(od.homeTeamOdds?.moneyLine ?? od.homeTeamOdds?.close?.odds);
    const mlAway = num(od.awayTeamOdds?.moneyLine ?? od.awayTeamOdds?.close?.odds);
    const mlDraw = num(od.drawOdds?.moneyLine ?? od.drawOdds?.close?.odds);
    if (mlHome != null && mlDraw != null && mlAway != null) {
      return {
        mlHome,
        mlDraw,
        mlAway,
        totalLine: num(od.overUnder),
        overOdds: null,
        underOdds: null,
        provider: od.provider?.name ?? null,
      };
    }
  }
  return null;
}

const RESULT = (r: unknown): FormGame["result"] => (r === "W" || r === "L" || r === "D" ? r : null);

function mapForm(group: any): FormGame[] {
  return (group?.events ?? []).slice(0, 5).map((e: any) => ({
    result: RESULT(e.gameResult),
    score: e.score ?? null,
    opponent: e.opponent?.displayName ?? (typeof e.opponent === "string" ? e.opponent : null),
    date: e.gameDate ?? null,
  }));
}

// lastFiveGames is [home, away] matched to the summary's home/away ids; falls back to array order.
export function parseForm(summary: any): { home: FormGame[]; away: FormGame[] } {
  const lf = summary?.lastFiveGames ?? [];
  const { home: homeId } = homeAwayEspnIds(summary);
  const home = (homeId != null && lf.find((g: any) => String(g.team?.id) === homeId)) || lf[0];
  if (homeId == null) {
    console.warn("espn-insights: unresolved home team id for form — using array order (may swap)");
  }
  const away = lf.find((g: any) => g !== home) ?? lf[1];
  return { home: mapForm(home), away: mapForm(away) };
}

// Head-to-head, oriented to the CURRENT fixture's home team and tallied from its POV.
export function parseH2H(summary: any): H2HData {
  const block = summary?.headToHeadGames?.[0];
  const events = block?.events ?? [];
  const { home: homeId } = homeAwayEspnIds(summary);
  const ref = homeId ?? (block?.team?.id != null ? String(block.team.id) : null);
  if (ref == null && events.length) {
    console.warn("espn-insights: unresolved home team id for H2H — orientation may be off");
  }
  const tally = { w: 0, d: 0, l: 0 };
  const games: H2HGameRow[] = [];
  for (const e of events.slice(0, 5)) {
    const hs = num(e.homeTeamScore);
    const as = num(e.awayTeamScore);
    if (hs == null || as == null) continue;
    // Orient: if the current home team was this event's home side, keep; else swap.
    const evHomeIsRef = ref != null && String(e.homeTeamId) === ref;
    const homeScore = evHomeIsRef ? hs : as;
    const awayScore = evHomeIsRef ? as : hs;
    const result = homeScore > awayScore ? "W" : homeScore < awayScore ? "L" : "D";
    tally[result === "W" ? "w" : result === "L" ? "l" : "d"]++;
    games.push({
      date: e.gameDate ?? null,
      competition: e.leagueName ?? e.competitionName ?? null,
      homeScore,
      awayScore,
      result,
    });
  }
  return { tally, games };
}

// Group table — already scoped to the fixture's group by the summary endpoint. Verified ESPN
// stat keys are lowercase: gamesplayed, wins, ties, losses, pointdifferential, points, rank.
export function parseStandings(summary: any): StandingsGroup | null {
  const groups = summary?.standings?.groups;
  if (!Array.isArray(groups) || groups.length === 0) return null;
  const { home: homeId } = homeAwayEspnIds(summary);
  const pick =
    groups.find((g: any) => (g.standings?.entries ?? []).some((e: any) => String(e.id) === homeId)) ??
    groups[0];
  const stat = (e: any, type: string) => {
    const s = (e.stats ?? []).find((x: any) => x.type === type);
    return num(s?.value ?? s?.displayValue);
  };
  const rows: StandingsRow[] = (pick?.standings?.entries ?? [])
    .map((e: any) => ({
      team: typeof e.team === "string" ? e.team : (e.team?.displayName ?? null),
      id: e.id != null ? String(e.id) : null,
      gp: stat(e, "gamesplayed"),
      w: stat(e, "wins"),
      d: stat(e, "ties"),
      l: stat(e, "losses"),
      gd: stat(e, "pointdifferential"),
      pts: stat(e, "points"),
      rank: stat(e, "rank"),
    }))
    .sort((a: StandingsRow, b: StandingsRow) => (a.rank ?? 99) - (b.rank ?? 99));
  return rows.length ? { rows } : null;
}

async function fetchSummary(slug: string, externalId: number, signal?: AbortSignal): Promise<any | null> {
  if (!slug) return null;
  if (!Number.isInteger(externalId) || externalId <= 0) return null;
  try {
    const res = await fetch(`${SUMMARY(slug)}?event=${externalId}`, { cache: "no-store", signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // timeout / network — degrade to "no insights"
  }
}

// Build the row to upsert from a summary payload (pure — exported for tests).
export function buildInsightsRow(fixtureId: string, summary: any) {
  const odds = parseOdds(summary);
  const model = odds ? modelFromOdds(odds) : null;
  const { home, away } = parseForm(summary);
  return {
    fixture_id: fixtureId,
    ml_home: odds?.mlHome ?? null,
    ml_draw: odds?.mlDraw ?? null,
    ml_away: odds?.mlAway ?? null,
    total_line: odds?.totalLine ?? null,
    provider: odds?.provider ?? null,
    p_home: model?.pHome ?? null,
    p_draw: model?.pDraw ?? null,
    p_away: model?.pAway ?? null,
    lambda_home: model?.lambdaHome ?? null,
    lambda_away: model?.lambdaAway ?? null,
    top_scores: model?.topScores ?? null,
    p_btts: model?.pBtts ?? null,
    p_cs_home: model?.pCleanSheetHome ?? null,
    p_cs_away: model?.pCleanSheetAway ?? null,
    p_over: model?.pOver ?? null,
    form_home: home,
    form_away: away,
    h2h: parseH2H(summary),
    standings: parseStandings(summary),
    odds_available: !!model,
    fetched_at: new Date().toISOString(),
  };
}

// A fixture can only have insights if ESPN can see it: an event id AND the competition's
// ESPN slug. Never guess the slug — a PL fixture must never be fetched from fifa.world.
export type InsightsFixture = { id: string; external_id: number; espn_slug: string | null };

type RefreshResult = {
  skipped?: boolean;
  updated?: boolean;
  oddsAvailable?: boolean;
  error?: string;
  row?: any;
};

// Fetch ESPN + upsert (no TTL read — callers decide staleness). Bounded by an abort signal.
async function fetchAndUpsert(admin: Admin, fx: InsightsFixture, signal?: AbortSignal): Promise<RefreshResult> {
  if (!fx.espn_slug) return { skipped: true };
  const summary = await fetchSummary(fx.espn_slug, fx.external_id, signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS));
  if (!summary) return { error: "espn summary fetch failed" };
  const row = buildInsightsRow(fx.id, summary);
  const { error } = await admin.from("fixture_insights").upsert(row, { onConflict: "fixture_id" });
  if (error) return { error: error.message };
  return { updated: true, oddsAvailable: row.odds_available, row };
}

// Refresh one fixture's insights if its cache is stale; returns the row (fresh or just-written) so
// the cold-miss page path can render without a second read.
export async function refreshInsights(
  admin: Admin,
  fx: InsightsFixture,
  opts?: { ttlMs?: number; signal?: AbortSignal },
): Promise<RefreshResult> {
  const ttl = opts?.ttlMs ?? INSIGHTS_TTL_MS;
  const { data: existing } = await admin
    .from("fixture_insights")
    .select("*")
    .eq("fixture_id", fx.id)
    .maybeSingle();
  if (existing?.fetched_at && Date.now() - new Date(existing.fetched_at).getTime() < ttl) {
    return { skipped: true, row: existing };
  }
  return fetchAndUpsert(admin, fx, opts?.signal);
}

// Cron entry: refresh upcoming open fixtures whose cache is stale. One upfront staleness query +
// capped-concurrency ESPN calls. Bounded by the window so we never fetch the whole tournament.
export async function pollInsights(admin: Admin): Promise<{ checked: number; updated: number }> {
  const now = Date.now();
  const fromIso = new Date(now - POLL_GRACE_MS).toISOString();
  const untilIso = new Date(now + INSIGHTS_WINDOW_MS).toISOString();
  const { data: fxs } = await admin
    .from("fixtures")
    .select("id, external_id, kickoff_at, competitions!inner(espn_slug)")
    .eq("status", "scheduled")
    .not("external_id", "is", null)
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null)
    .gte("kickoff_at", fromIso)
    .lte("kickoff_at", untilIso);
  const list: InsightsFixture[] = (fxs ?? [])
    .map((f: any) => ({
      id: f.id,
      external_id: Number(f.external_id),
      espn_slug: f.competitions?.espn_slug ?? null,
    }))
    .filter((f: InsightsFixture) => !!f.espn_slug);
  if (!list.length) return { checked: 0, updated: 0 };

  // Single upfront staleness lookup — avoids a per-fixture SELECT.
  const { data: cached } = await admin
    .from("fixture_insights")
    .select("fixture_id, fetched_at")
    .in("fixture_id", list.map((f) => f.id));
  const fetchedById = new Map((cached ?? []).map((r: any) => [r.fixture_id, r.fetched_at]));
  const stale = list.filter((f) => {
    const at = fetchedById.get(f.id);
    return !at || now - new Date(at).getTime() >= INSIGHTS_TTL_MS;
  });

  let updated = 0;
  for (let i = 0; i < stale.length; i += POLL_CONCURRENCY) {
    const batch = stale.slice(i, i + POLL_CONCURRENCY);
    const results = await Promise.all(batch.map((f) => fetchAndUpsert(admin, f)));
    updated += results.filter((r) => r.updated).length;
  }
  return { checked: stale.length, updated };
}

// ---- read-side view model -----------------------------------------------------------------
// The Supabase client is untyped and returns `numeric` columns as STRINGS. This is the single
// boundary that coerces a raw fixture_insights row into a typed, number-safe shape for the UI.

export interface InsightsView {
  oddsAvailable: boolean;
  provider: string | null;
  ml: { home: number; draw: number; away: number } | null;
  probs: { home: number; draw: number; away: number } | null;
  totalLine: number | null;
  pOver: number | null;
  topScores: ScoreProb[];
  btts: number | null;
  cleanSheet: { home: number | null; away: number | null };
  formHome: FormGame[];
  formAway: FormGame[];
  h2h: H2HData | null;
  standings: StandingsGroup | null;
}

const toNum = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

function toScoreProbs(v: unknown): ScoreProb[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x: any): x is ScoreProb =>
      x && typeof x.h === "number" && typeof x.a === "number" && typeof x.p === "number",
  );
}
function toFormGames(v: unknown): FormGame[] {
  return Array.isArray(v) ? (v as FormGame[]) : [];
}

export function mapInsightsView(raw: any): InsightsView | null {
  if (!raw) return null;
  const oddsAvailable = !!raw.odds_available;
  const ml = oddsAvailable
    ? { home: toNum(raw.ml_home) ?? 0, draw: toNum(raw.ml_draw) ?? 0, away: toNum(raw.ml_away) ?? 0 }
    : null;
  const probs = oddsAvailable
    ? { home: toNum(raw.p_home) ?? 0, draw: toNum(raw.p_draw) ?? 0, away: toNum(raw.p_away) ?? 0 }
    : null;
  return {
    oddsAvailable,
    provider: raw.provider ?? null,
    ml,
    probs,
    totalLine: toNum(raw.total_line),
    pOver: toNum(raw.p_over),
    topScores: toScoreProbs(raw.top_scores),
    btts: toNum(raw.p_btts),
    cleanSheet: { home: toNum(raw.p_cs_home), away: toNum(raw.p_cs_away) },
    formHome: toFormGames(raw.form_home),
    formAway: toFormGames(raw.form_away),
    h2h: raw.h2h ?? null,
    standings: raw.standings ?? null,
  };
}
