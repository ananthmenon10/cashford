import { describe, it, expect } from "vitest";
import {
  gradeOutcome, isCorrect, isExact, goalError, accuracy, currentStreak, potRecord, netTotal,
  cumulativeNet, bestResult, luckyTeam, biggestNight, calledUpsets, favouritesWonPct, type Entry,
} from "./analytics";

// Build a graded entry; overrides win.
function e(over: Partial<Entry> = {}): Entry {
  return {
    outcome: "home", predHome: 2, predAway: 0,
    ftHome: 2, ftAway: 0, isKnockout: false, advancer: null,
    net: 100, kickoffMs: 1000, dayKey: "Sat 13 Jun",
    homeLabel: "Brazil", awayLabel: "Serbia", model: null,
    ...over,
  };
}

describe("gradeOutcome", () => {
  it("group stage: scoreline sign", () => {
    expect(gradeOutcome({ ftHome: 2, ftAway: 0, isKnockout: false })).toBe("home");
    expect(gradeOutcome({ ftHome: 0, ftAway: 1, isKnockout: false })).toBe("away");
    expect(gradeOutcome({ ftHome: 1, ftAway: 1, isKnockout: false })).toBe("draw");
  });
  it("knockout: advancer wins regardless of 90' score", () => {
    expect(gradeOutcome({ ftHome: 1, ftAway: 1, isKnockout: true, advancer: "away" })).toBe("away");
    expect(gradeOutcome({ ftHome: 0, ftAway: 2, isKnockout: true, advancer: "home" })).toBe("home");
  });
});

describe("per-entry skill checks", () => {
  it("correct outcome but not exact", () => {
    const x = e({ outcome: "home", predHome: 3, predAway: 1, ftHome: 2, ftAway: 0 });
    expect(isCorrect(x)).toBe(true);
    expect(isExact(x)).toBe(false);
    expect(goalError(x)).toBe(2); // |4 - 2|
  });
  it("exact implies correct", () => {
    const x = e({ predHome: 2, predAway: 0, ftHome: 2, ftAway: 0 });
    expect(isExact(x)).toBe(true);
    expect(isCorrect(x)).toBe(true);
    expect(goalError(x)).toBe(0);
  });
  it("wrong outcome", () => {
    expect(isCorrect(e({ outcome: "away", ftHome: 2, ftAway: 0 }))).toBe(false);
  });
});

describe("accuracy", () => {
  it("aggregates correct/exact/goal bias", () => {
    const a = accuracy([
      e({ outcome: "home", predHome: 2, predAway: 0, ftHome: 2, ftAway: 0 }), // exact+correct, bias 0
      e({ outcome: "home", predHome: 3, predAway: 1, ftHome: 1, ftAway: 0 }), // correct, bias +3
      e({ outcome: "away", predHome: 0, predAway: 1, ftHome: 1, ftAway: 0 }), // wrong, bias 0
    ]);
    expect(a.graded).toBe(3);
    expect(a.correct).toBe(2);
    expect(a.exact).toBe(1);
    expect(a.correctPct).toBeCloseTo(2 / 3);
    expect(a.exactPct).toBeCloseTo(1 / 3);
    expect(a.goalBias).toBeCloseTo((0 + 3 + 0) / 3);
  });
  it("empty → nulls, not NaN", () => {
    expect(accuracy([])).toMatchObject({ graded: 0, correctPct: null, goalBias: null });
  });
});

describe("currentStreak", () => {
  it("counts correct runs from the most recent backwards", () => {
    const entries = [
      e({ kickoffMs: 1, outcome: "away", ftHome: 2, ftAway: 0 }), // wrong (oldest)
      e({ kickoffMs: 2, outcome: "home", ftHome: 2, ftAway: 0 }), // correct
      e({ kickoffMs: 3, outcome: "home", ftHome: 1, ftAway: 0 }), // correct (most recent)
    ];
    expect(currentStreak(entries)).toBe(2);
  });
  it("breaks at the most recent wrong", () => {
    expect(currentStreak([e({ kickoffMs: 9, outcome: "away", ftHome: 2, ftAway: 0 })])).toBe(0);
  });
});

describe("money aggregates", () => {
  const set = [e({ net: 100 }), e({ net: -40 }), e({ net: 0 }), e({ net: null })];
  it("netTotal ignores null", () => expect(netTotal(set)).toBe(60));
  it("potRecord counts settled + wins", () => expect(potRecord(set)).toEqual({ entered: 3, won: 1 }));
  it("cumulativeNet runs over settled in kickoff order", () => {
    const pts = cumulativeNet([e({ kickoffMs: 2, net: 50 }), e({ kickoffMs: 1, net: 100 }), e({ kickoffMs: 3, net: null })]);
    expect(pts.map((p) => p.y)).toEqual([100, 150]);
  });
  it("bestResult picks max net", () => {
    expect(bestResult(set)?.net).toBe(100);
    expect(bestResult([e({ net: null })])).toBeNull();
  });
});

describe("luckyTeam & biggestNight", () => {
  it("luckyTeam sums net across both sides", () => {
    const r = luckyTeam([
      e({ homeLabel: "England", awayLabel: "Spain", net: 200 }),
      e({ homeLabel: "France", awayLabel: "England", net: 100 }),
    ]);
    expect(r).toEqual({ team: "England", net: 300 });
  });
  it("biggestNight sums net by day", () => {
    const r = biggestNight([
      e({ dayKey: "Fri 12 Jun", net: 100 }),
      e({ dayKey: "Sat 13 Jun", net: 300 }),
      e({ dayKey: "Sat 13 Jun", net: 50 }),
    ]);
    expect(r).toEqual({ dayKey: "Sat 13 Jun", net: 350 });
  });
});

describe("match intelligence", () => {
  it("favouritesWonPct over finished fixtures with odds", () => {
    const pct = favouritesWonPct([
      { model: { pHome: 0.7, pDraw: 0.2, pAway: 0.1 }, result: { ftHome: 2, ftAway: 0, isKnockout: false } }, // fav home, home won ✓
      { model: { pHome: 0.2, pDraw: 0.3, pAway: 0.5 }, result: { ftHome: 1, ftAway: 0, isKnockout: false } }, // fav away, home won ✗
    ]);
    expect(pct).toBeCloseTo(0.5);
    expect(favouritesWonPct([])).toBeNull();
  });
  it("calledUpsets: correct picks against the model favourite", () => {
    const n = calledUpsets([
      e({ outcome: "away", ftHome: 0, ftAway: 1, model: { pHome: 0.7, pDraw: 0.2, pAway: 0.1 } }), // correct + underdog ✓
      e({ outcome: "home", ftHome: 2, ftAway: 0, model: { pHome: 0.7, pDraw: 0.2, pAway: 0.1 } }), // correct + favourite ✗
      e({ outcome: "away", ftHome: 2, ftAway: 0, model: { pHome: 0.2, pDraw: 0.2, pAway: 0.6 } }), // wrong ✗
      e({ outcome: "home", ftHome: 1, ftAway: 0, model: null }), // no model ✗
    ]);
    expect(n).toBe(1);
  });
});
