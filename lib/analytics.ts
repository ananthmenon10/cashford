// Pure analytics engine for the home Analytics tab (PRD docs/prds/2026-06-21-home-analytics-tab-prd.md).
// Two honest lenses: 💰 money (the stored net) and 🎯 skill (accuracy DERIVED here by comparing
// each pick to the real result — independent of who won the pot). No I/O; lib/home-analytics.ts
// builds the inputs from the DB and calls these. Fully unit-testable (lib/settlement.ts style).

export type Outcome = "home" | "draw" | "away";

export interface ResultInfo {
  ftHome: number;
  ftAway: number;
  isKnockout: boolean;
  advancer?: Outcome | null; // who went through (knockout only)
}

// The graded outcome of a finished fixture: knockout → who advanced; else the 90' scoreline sign.
export function gradeOutcome(r: ResultInfo): Outcome {
  if (r.isKnockout) return r.advancer === "home" || r.advancer === "away" ? r.advancer : r.ftHome >= r.ftAway ? "home" : "away";
  if (r.ftHome > r.ftAway) return "home";
  if (r.ftHome < r.ftAway) return "away";
  return "draw";
}

export interface ModelProbs { pHome: number; pDraw: number; pAway: number }

// A graded prediction: the viewer's pick on a FINISHED fixture. `net` is the settled net (null if
// the contest hasn't been settled yet — accuracy still counts; money does not).
export interface Entry {
  outcome: Outcome;
  predHome: number;
  predAway: number;
  ftHome: number;
  ftAway: number;
  isKnockout: boolean;
  advancer?: Outcome | null;
  net: number | null;
  kickoffMs: number;
  dayKey?: string; // legacy pure-helper label; the UI groups raw kickoffAt in the browser timezone
  kickoffAt?: string;
  homeLabel: string;
  awayLabel: string;
  model?: ModelProbs | null; // pre-match model probabilities, when available
  slug?: string; // league slug — for linking "best result" into its match page
  contestId?: string;
}

const resultOf = (e: Entry): ResultInfo => ({ ftHome: e.ftHome, ftAway: e.ftAway, isKnockout: e.isKnockout, advancer: e.advancer });
export const isCorrect = (e: Entry) => e.outcome === gradeOutcome(resultOf(e));
export const isExact = (e: Entry) => e.predHome === e.ftHome && e.predAway === e.ftAway;
export const goalError = (e: Entry) => Math.abs(e.predHome + e.predAway - (e.ftHome + e.ftAway));

const favourite = (m: ModelProbs): Outcome =>
  m.pHome >= m.pDraw && m.pHome >= m.pAway ? "home" : m.pAway >= m.pDraw && m.pAway >= m.pHome ? "away" : "draw";

export interface Accuracy {
  graded: number;
  correct: number;
  exact: number;
  correctPct: number | null; // skill lens
  exactPct: number | null;
  avgGoalError: number | null;
  goalBias: number | null; // mean (predicted total − actual total); + = predicts high
}

// 🎯 skill aggregate over a set of graded predictions.
export function accuracy(entries: Entry[]): Accuracy {
  const graded = entries.length;
  if (!graded) return { graded: 0, correct: 0, exact: 0, correctPct: null, exactPct: null, avgGoalError: null, goalBias: null };
  let correct = 0, exact = 0, gerr = 0, bias = 0;
  for (const e of entries) {
    if (isCorrect(e)) correct++;
    if (isExact(e)) exact++;
    gerr += goalError(e);
    bias += e.predHome + e.predAway - (e.ftHome + e.ftAway);
  }
  return { graded, correct, exact, correctPct: correct / graded, exactPct: exact / graded, avgGoalError: gerr / graded, goalBias: bias / graded };
}

// Current run of correct outcomes from the most recent graded match backwards.
export function currentStreak(entries: Entry[]): number {
  const byRecent = [...entries].sort((a, b) => b.kickoffMs - a.kickoffMs || (a.homeLabel < b.homeLabel ? 1 : -1));
  let s = 0;
  for (const e of byRecent) {
    if (isCorrect(e)) s++;
    else break;
  }
  return s;
}

// 💰 pot record over SETTLED predictions (net resolved).
export function potRecord(entries: Entry[]): { entered: number; won: number } {
  const settled = entries.filter((e) => e.net != null);
  return { entered: settled.length, won: settled.filter((e) => (e.net ?? 0) > 0).length };
}

export const netTotal = (entries: Entry[]): number => entries.reduce((t, e) => t + (e.net ?? 0), 0);

// Running net over time (settled, kickoff-ascending) → points for a cumulative chart.
export function cumulativeNet(entries: Entry[]): { x: number; y: number }[] {
  const settled = entries.filter((e) => e.net != null).sort((a, b) => a.kickoffMs - b.kickoffMs);
  let cum = 0;
  return settled.map((e, i) => ({ x: i, y: (cum += e.net ?? 0) }));
}

// Net grouped by matchday (settled), ordered by each day's earliest kickoff — for the per-day bars.
export function dailyNet(entries: Entry[]): { dayKey: string; net: number }[] {
  const byDay = new Map<string, { net: number; t: number }>();
  for (const e of entries) {
    if (e.net == null || !e.dayKey) continue;
    const cur = byDay.get(e.dayKey);
    if (cur) { cur.net += e.net; cur.t = Math.min(cur.t, e.kickoffMs); }
    else byDay.set(e.dayKey, { net: e.net, t: e.kickoffMs });
  }
  return [...byDay.entries()].sort((a, b) => a[1].t - b[1].t).map(([dayKey, v]) => ({ dayKey, net: v.net }));
}

export function bestResult(entries: Entry[]): Entry | null {
  const settled = entries.filter((e) => e.net != null);
  if (!settled.length) return null;
  return settled.reduce((m, e) => ((e.net ?? 0) > (m.net ?? 0) ? e : m), settled[0]);
}

// Team the viewer nets the most on (counting every settled fixture that team played in).
export function luckyTeam(entries: Entry[]): { team: string; net: number } | null {
  const byTeam = new Map<string, number>();
  for (const e of entries) {
    if (e.net == null) continue;
    byTeam.set(e.homeLabel, (byTeam.get(e.homeLabel) ?? 0) + e.net);
    byTeam.set(e.awayLabel, (byTeam.get(e.awayLabel) ?? 0) + e.net);
  }
  let best: { team: string; net: number } | null = null;
  for (const [team, net] of byTeam) if (!best || net > best.net || (net === best.net && team < best.team)) best = { team, net };
  return best;
}

// Best single matchday by net.
export function biggestNight(entries: Entry[]): { dayKey: string; net: number } | null {
  const byDay = new Map<string, number>();
  for (const e of entries) {
    if (e.net == null || !e.dayKey) continue;
    byDay.set(e.dayKey, (byDay.get(e.dayKey) ?? 0) + e.net);
  }
  let best: { dayKey: string; net: number } | null = null;
  for (const [dayKey, net] of byDay) if (!best || net > best.net) best = { dayKey, net };
  return best;
}

// 🎯 the viewer's correct calls that went AGAINST the model favourite (an "upset" they nailed).
export function calledUpsets(entries: Entry[]): number {
  let n = 0;
  for (const e of entries) {
    if (!e.model || !isCorrect(e)) continue;
    if (e.outcome !== favourite(e.model)) n++;
  }
  return n;
}

// Tournament-wide: how often the model favourite actually won (over finished fixtures with odds).
export function favouritesWonPct(rows: { model: ModelProbs; result: ResultInfo }[]): number | null {
  if (!rows.length) return null;
  let won = 0;
  for (const r of rows) if (gradeOutcome(r.result) === favourite(r.model)) won++;
  return won / rows.length;
}

// ── View model handed to the client <AnalyticsTab/> (plain, serializable) ──────────────────────
export interface BestResultView { net: number; label: string; slug: string; contestId: string }

export interface GlobalAnalytics {
  net: number; // 💰 total net across all the viewer's leagues
  acc: Accuracy; // 🎯 correctPct / exactPct / goalBias / graded
  pot: { entered: number; won: number }; // 💰
  streak: number; // 🎯
  daily: { kickoffAt: string; net: number }[]; // 💰 raw settled entries; the browser groups local matchdays
  best: BestResultView | null; // 💰
  lucky: { team: string; net: number } | null; // 💰
  favouritesWonPct: number | null; // match intelligence
  calledUpsets: number; // 🎯 match intelligence
}

export interface SharpRow { userId: string; name: string; isMe: boolean; accuracyPct: number | null; graded: number }
export interface RivalRow { userId: string; name: string; accuracyPct: number | null; graded: number; moneyFlow: number }

export interface LeagueAnalytics {
  leagueId: string; leagueName: string; slug: string;
  net: number; // 💰 viewer's net in this league
  rank: number; members: number; // 💰 standing
  acc: Accuracy; // 🎯 viewer's accuracy in this league
  sharpest: SharpRow[]; // 🎯 members ranked by accuracy (skill, not money)
  rivals: RivalRow[]; // everyone except the viewer, for the head-to-head selector
}

export interface AnalyticsView {
  global: GlobalAnalytics;
  leagues: LeagueAnalytics[];
}
