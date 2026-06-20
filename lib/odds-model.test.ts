import { describe, it, expect } from "vitest";
import { americanToProb, devig3, modelFromOdds, type OddsInput } from "./odds-model";

// Live odds probed from ESPN 2026-06-20 (Ivory Coast v Germany): home -195, draw +370, away +500.
const FAVOURITE: OddsInput = { mlHome: -195, mlDraw: 370, mlAway: 500, totalLine: 2.5, overOdds: -170, underOdds: 140 };
const EVEN: OddsInput = { mlHome: 200, mlDraw: 220, mlAway: 200, totalLine: 2.5 };

const sum = (m: { pHome: number; pDraw: number; pAway: number }) => m.pHome + m.pDraw + m.pAway;

describe("americanToProb", () => {
  it("converts favourites and underdogs", () => {
    expect(americanToProb(-200)).toBeCloseTo(0.6667, 3); // 200/300
    expect(americanToProb(100)).toBeCloseTo(0.5, 3);
    expect(americanToProb(500)).toBeCloseTo(0.1667, 3); // 100/600
  });
});

describe("devig3", () => {
  it("removes the overround so probabilities sum to exactly 1", () => {
    const m = devig3(FAVOURITE.mlHome, FAVOURITE.mlDraw, FAVOURITE.mlAway);
    expect(sum(m)).toBeCloseTo(1, 10);
    expect(m.pHome).toBeGreaterThan(m.pDraw);
    expect(m.pDraw).toBeGreaterThan(m.pAway);
  });
});

describe("modelFromOdds — home favourite", () => {
  const m = modelFromOdds(FAVOURITE);

  it("keeps the de-vigged 1X2 (sums to 1, home most likely)", () => {
    expect(sum(m)).toBeCloseTo(1, 10);
    expect(m.pHome).toBeGreaterThan(m.pAway);
    expect(m.pHome).toBeGreaterThan(m.pDraw);
  });

  it("assigns the favourite the higher expected goals", () => {
    expect(m.lambdaHome).toBeGreaterThan(m.lambdaAway);
  });

  it("returns 5 scorelines sorted by probability, with the favourite not losing the top score", () => {
    expect(m.topScores).toHaveLength(5);
    for (let i = 1; i < m.topScores.length; i++) {
      expect(m.topScores[i - 1].p).toBeGreaterThanOrEqual(m.topScores[i].p);
    }
    expect(m.topScores[0].h).toBeGreaterThanOrEqual(m.topScores[0].a);
    expect(m.topScores[0].p).toBeGreaterThan(0);
    expect(m.topScores[0].p).toBeLessThan(1);
  });

  it("gives the favourite the better clean-sheet chance", () => {
    expect(m.pCleanSheetHome).toBeGreaterThan(m.pCleanSheetAway);
    expect(m.pBtts).toBeGreaterThan(0);
    expect(m.pBtts).toBeLessThan(1);
  });
});

describe("modelFromOdds — even match", () => {
  const m = modelFromOdds(EVEN);
  it("is symmetric: equal probabilities and equal expected goals", () => {
    expect(Math.abs(m.pHome - m.pAway)).toBeLessThan(0.01);
    expect(Math.abs(m.lambdaHome - m.lambdaAway)).toBeLessThan(0.05);
  });
});

describe("modelFromOdds — totals drive scoring", () => {
  it("a higher goals line lowers clean-sheet probability", () => {
    const low = modelFromOdds({ mlHome: 150, mlDraw: 220, mlAway: 200, totalLine: 1.5 });
    const high = modelFromOdds({ mlHome: 150, mlDraw: 220, mlAway: 200, totalLine: 3.5 });
    expect(high.lambdaHome + high.lambdaAway).toBeGreaterThan(low.lambdaHome + low.lambdaAway);
    expect(high.pCleanSheetHome).toBeLessThan(low.pCleanSheetHome);
  });

  it("falls back cleanly when no totals line is given (no NaN, pOver finite)", () => {
    const m = modelFromOdds({ mlHome: -195, mlDraw: 370, mlAway: 500 });
    expect(Number.isFinite(m.lambdaHome)).toBe(true);
    expect(sum(m)).toBeCloseTo(1, 10);
    expect(m.topScores[0].p).toBeGreaterThan(0);
    expect(m.pOver).toBeGreaterThan(0);
    expect(m.pOver).toBeLessThan(1);
  });
});

describe("modelFromOdds — pOver from de-vigged total", () => {
  it("leans high-scoring when over is favoured (-170 over / +140 under)", () => {
    // de-vig: 0.6296 / (0.6296 + 0.4167) ≈ 0.602
    expect(modelFromOdds(FAVOURITE).pOver).toBeGreaterThan(0.5);
  });
  it("leans low-scoring when under is favoured (+160 over / -200 under)", () => {
    const m = modelFromOdds({ mlHome: 150, mlDraw: 220, mlAway: 200, totalLine: 2.5, overOdds: 160, underOdds: -200 });
    expect(m.pOver).toBeLessThan(0.5);
  });
});
