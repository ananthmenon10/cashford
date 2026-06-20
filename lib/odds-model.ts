// Derive 1X2 probabilities + most-likely scorelines from bookmaker moneyline (+ optional
// over/under total) using an independent-Poisson goals model. Pure, no deps, fully unit-tested.
// This is the only "maths" in the feature — a wrong model misleads users, so it is tested
// against known inputs. See plan docs/plans/2026-06-20-002.
//
// Pipeline: american odds → implied probs → de-vig the 3-way market → solve a goal sum
// (from the totals line, else a World-Cup-average fallback) → split the sum into λ_home/λ_away
// so the model reproduces the de-vigged 1X2 → build the scoreline grid → read off the
// most-likely scores, BTTS and clean-sheet probabilities.

export interface ScoreProb {
  h: number;
  a: number;
  p: number;
}

export interface OddsModel {
  pHome: number;
  pDraw: number;
  pAway: number; // de-vigged 1X2 — sums to 1
  lambdaHome: number;
  lambdaAway: number; // expected goals per side
  topScores: ScoreProb[]; // sorted desc — topScores[0] is the single most-likely score
  pBtts: number; // both teams to score
  pCleanSheetHome: number; // home keeps a clean sheet (away fails to score)
  pCleanSheetAway: number;
  pOver: number; // P(total goals over the line) — de-vigged from the 2-way total when available
}

export interface OddsInput {
  mlHome: number;
  mlDraw: number;
  mlAway: number; // american moneyline (e.g. -195 / +370 / +500)
  totalLine?: number | null; // over/under goals line, e.g. 2.5
  overOdds?: number | null; // american; combined with underOdds to de-vig the total
  underOdds?: number | null;
}

const DEFAULT_LAMBDA_SUM = 2.7; // WC2022 averaged ≈ 2.69 goals/game — fallback when no total
const GRID = 10; // sum the Poisson grid over 0..GRID goals (captures ~all the mass)
const TOP_N = 5;

// 0! .. GRID! — precomputed so the lambda search below isn't recomputing factorials.
const FACT: number[] = (() => {
  const f = [1];
  for (let n = 1; n <= GRID; n++) f[n] = f[n - 1] * n;
  return f;
})();

function poissonPMF(k: number, lambda: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / FACT[k];
}

// American odds → implied probability (still includes the book's margin).
export function americanToProb(odds: number): number {
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

// Remove the overround from a 3-way (home/draw/away) market and normalise to a distribution.
export function devig3(homeOdds: number, drawOdds: number, awayOdds: number) {
  const rh = americanToProb(homeOdds);
  const rd = americanToProb(drawOdds);
  const ra = americanToProb(awayOdds);
  const s = rh + rd + ra;
  return { pHome: rh / s, pDraw: rd / s, pAway: ra / s };
}

// Model the 1X2 split implied by two independent Poisson goal counts.
function modelProbs(lh: number, la: number) {
  let pH = 0;
  let pD = 0;
  let pA = 0;
  for (let h = 0; h <= GRID; h++) {
    const ph = poissonPMF(h, lh);
    for (let a = 0; a <= GRID; a++) {
      const p = ph * poissonPMF(a, la);
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;
    }
  }
  return { pH, pD, pA };
}

// Split a fixed goal sum into home/away shares that best reproduce the de-vigged 1X2.
function solveLambdas(lambdaSum: number, pHome: number, pDraw: number, pAway: number) {
  let bestErr = Infinity;
  let bestLh = lambdaSum / 2;
  for (let share = 0.05; share <= 0.95; share += 0.005) {
    const lh = lambdaSum * share;
    const la = lambdaSum - lh;
    const m = modelProbs(lh, la);
    const err = Math.abs(m.pH - pHome) + Math.abs(m.pD - pDraw) + Math.abs(m.pA - pAway);
    if (err < bestErr) {
      bestErr = err;
      bestLh = lh;
    }
  }
  return { lambdaHome: bestLh, lambdaAway: lambdaSum - bestLh };
}

// Total goals ≈ Poisson(λ_sum). Under-prob = P(goals ≤ floor(line)) = Poisson CDF. Higher λ_sum
// ⇒ lower under-prob, so binary-search λ_sum to match the de-vigged under probability.
function solveLambdaSumFromTotal(line: number, pOver: number): number {
  const k = Math.floor(line);
  const pUnder = 1 - pOver;
  let lo = 0.2;
  let hi = 7;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    let cdf = 0;
    for (let g = 0; g <= k && g <= GRID; g++) cdf += poissonPMF(g, mid);
    if (cdf > pUnder) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function modelFromOdds(input: OddsInput): OddsModel {
  const { pHome, pDraw, pAway } = devig3(input.mlHome, input.mlDraw, input.mlAway);

  let lambdaSum = DEFAULT_LAMBDA_SUM;
  // De-vigged over-probability from the 2-way total, when both legs are present. This is the
  // authoritative pOver — more accurate than integrating the grid, and it never drops the push
  // mass on whole-number lines. Grid integral is only the fallback below.
  let pOverDevig: number | null = null;
  if (input.totalLine != null && input.overOdds != null && input.underOdds != null) {
    const ro = americanToProb(input.overOdds);
    const ru = americanToProb(input.underOdds);
    pOverDevig = ro / (ro + ru); // de-vig the 2-way total
    lambdaSum = solveLambdaSumFromTotal(input.totalLine, pOverDevig);
  } else if (input.totalLine != null) {
    lambdaSum = input.totalLine; // the line itself is a reasonable expected-goals proxy
  }

  const { lambdaHome, lambdaAway } = solveLambdas(lambdaSum, pHome, pDraw, pAway);

  // Grid-based pOver fallback: P(total goals > floor(line)). For a .5 line this is exact; we only
  // use it when de-vigged odds aren't available (e.g. the legacy odds[] path gives a line but no
  // over/under prices).
  const overFloor = Math.floor(input.totalLine ?? lambdaSum);
  const scores: ScoreProb[] = [];
  let pBtts = 0;
  let pOverGrid = 0;
  for (let h = 0; h <= GRID; h++) {
    const ph = poissonPMF(h, lambdaHome);
    for (let a = 0; a <= GRID; a++) {
      const p = ph * poissonPMF(a, lambdaAway);
      scores.push({ h, a, p });
      if (h > 0 && a > 0) pBtts += p;
      if (h + a > overFloor) pOverGrid += p;
    }
  }
  scores.sort((x, y) => y.p - x.p);

  return {
    pHome,
    pDraw,
    pAway,
    lambdaHome,
    lambdaAway,
    topScores: scores.slice(0, TOP_N),
    pBtts,
    pCleanSheetHome: Math.exp(-lambdaAway), // away scores 0
    pCleanSheetAway: Math.exp(-lambdaHome), // home scores 0
    pOver: pOverDevig ?? pOverGrid,
  };
}
