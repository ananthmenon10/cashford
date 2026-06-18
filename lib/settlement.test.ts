import { describe, it, expect } from "vitest";
import { settle, simplifyDebts, type Prediction, type Actual } from "./settlement";

const S = 500;
const p = (userId: string, outcome: Prediction["outcome"], h: number, a: number): Prediction => ({
  userId, outcome, predHome: h, predAway: a,
});
const group = (h: number, a: number): Actual => ({ isKnockout: false, ftHome: h, ftAway: a });
const ko = (advancer: "home" | "away", h: number, a: number): Actual => ({ isKnockout: true, ftHome: h, ftAway: a, advancer });
const net = (s: ReturnType<typeof settle>, id: string) => s.results.find((r) => r.userId === id)!.net;
const sumNet = (s: ReturnType<typeof settle>) => s.results.reduce((t, r) => t + r.net, 0);

describe("mixed outcome (some right, some wrong)", () => {
  it("C1: 1 correct, 3 wrong → winner takes 3 stakes", () => {
    const s = settle([p("a", "home", 2, 1), p("b", "away", 0, 1), p("c", "draw", 1, 1), p("d", "away", 1, 2)], group(2, 0), S);
    expect(net(s, "a")).toBe(1500);
    expect([net(s, "b"), net(s, "c"), net(s, "d")]).toEqual([-500, -500, -500]);
    expect(sumNet(s)).toBe(0);
  });
  it("C2: 3 correct, 1 wrong → ₹500÷3 with ₹1 remainder to first two", () => {
    const s = settle([p("a", "home", 1, 0), p("b", "home", 2, 0), p("c", "home", 3, 0), p("d", "away", 0, 1)], group(2, 0), S);
    expect(net(s, "a")).toBe(167);
    expect(net(s, "b")).toBe(167);
    expect(net(s, "c")).toBe(166);
    expect(net(s, "d")).toBe(-500);
    expect(sumNet(s)).toBe(0);
  });
  it("C3: 2 correct, 2 wrong → even split", () => {
    const s = settle([p("a", "home", 1, 0), p("b", "home", 2, 0), p("c", "away", 0, 1), p("d", "draw", 1, 1)], group(2, 0), S);
    expect([net(s, "a"), net(s, "b")]).toEqual([500, 500]);
    expect([net(s, "c"), net(s, "d")]).toEqual([-500, -500]);
  });
  it("C4: example 1 — 3 entrants, 1 correct (not_entered excluded)", () => {
    const s = settle([p("a", "home", 2, 1), p("b", "away", 0, 1), p("c", "away", 1, 2)], group(1, 0), S);
    expect(net(s, "a")).toBe(1000);
    expect([net(s, "b"), net(s, "c")]).toEqual([-500, -500]);
  });
  it("C5: example 2 — 3 entrants, 2 correct → ₹250 each", () => {
    const s = settle([p("a", "home", 2, 1), p("b", "home", 1, 0), p("c", "away", 0, 1)], group(1, 0), S);
    expect([net(s, "a"), net(s, "b")]).toEqual([250, 250]);
    expect(net(s, "c")).toBe(-500);
  });
  it("C13: draw is a winning outcome", () => {
    const s = settle([p("a", "draw", 1, 1), p("b", "home", 2, 1), p("c", "away", 0, 1), p("d", "draw", 0, 0)], group(1, 1), S);
    expect([net(s, "a"), net(s, "d")]).toEqual([500, 500]);
    expect([net(s, "b"), net(s, "c")]).toEqual([-500, -500]);
  });
});

describe("unanimous outcome → layered scoreline tiebreak", () => {
  it("C6: exact score wins", () => {
    const s = settle([p("a", "home", 2, 1), p("b", "home", 3, 1), p("c", "home", 1, 0), p("d", "home", 3, 2)], group(2, 1), S);
    expect(net(s, "a")).toBe(1500);
  });
  it("C7: smallest total goal error wins (no exact)", () => {
    const s = settle([p("a", "home", 3, 1), p("b", "home", 3, 2), p("c", "home", 1, 0), p("d", "home", 4, 2)], group(2, 1), S);
    expect(net(s, "a")).toBe(1500);
  });
  it("C8: top tie → split", () => {
    const s = settle([p("a", "home", 3, 1), p("b", "home", 1, 0), p("c", "home", 3, 2), p("d", "home", 2, 0)], group(2, 1), S);
    expect([net(s, "a"), net(s, "d")]).toEqual([500, 500]);
    expect([net(s, "b"), net(s, "c")]).toEqual([-500, -500]);
  });
  it("C14: unanimous WRONG → least-wrong wins (total-goals level)", () => {
    const s = settle([p("a", "home", 2, 1), p("b", "home", 3, 0), p("c", "home", 1, 0), p("d", "home", 4, 1)], group(0, 1), S);
    expect(net(s, "c")).toBe(1500); // c (1-0) closest to 0-1 on total goals
  });
});

describe("Case C — mixed picks, nobody right (D9)", () => {
  it("C9: closest scoreline wins", () => {
    const s = settle([p("a", "home", 2, 1), p("b", "away", 1, 3), p("c", "home", 3, 0), p("d", "away", 0, 1)], group(2, 2), S);
    expect(net(s, "a")).toBe(1500);
  });
  it("C10: full scoreline tie → VOID (no_separation)", () => {
    const s = settle([p("a", "home", 2, 1), p("b", "away", 1, 2)], group(1, 1), S);
    expect(s.status).toBe("void");
    expect(s.voidReason).toBe("no_separation");
    expect(sumNet(s)).toBe(0);
  });
});

describe("void / participation", () => {
  it("C11: a single entry → void", () => {
    const s = settle([p("a", "home", 1, 0)], group(1, 0), S);
    expect(s.status).toBe("void");
    expect(s.voidReason).toBe("insufficient_entries");
  });
  it("C12: no entries → void", () => {
    const s = settle([], group(1, 0), S);
    expect(s.status).toBe("void");
    expect(s.transfers).toHaveLength(0);
  });
});

describe("knockout — advance-based, scoreline graded on 90'", () => {
  it("C15: advancer decides (mixed); scoreline ignored", () => {
    const s = settle([p("a", "home", 0, 0), p("b", "away", 0, 0), p("c", "home", 5, 5), p("d", "away", 9, 9)], ko("home", 1, 1), S);
    expect([net(s, "a"), net(s, "c")]).toEqual([500, 500]);
    expect([net(s, "b"), net(s, "d")]).toEqual([-500, -500]);
  });
  it("C16: unanimous advancer → 90' scoreline tiebreak", () => {
    const s = settle([p("a", "home", 2, 1), p("b", "home", 2, 0), p("c", "home", 1, 0), p("d", "home", 3, 1)], ko("home", 2, 1), S);
    expect(net(s, "a")).toBe(1500);
  });
  it("C17: scoreline is regulation even when decided on penalties", () => {
    const s = settle([p("a", "away", 1, 1), p("b", "away", 0, 1), p("c", "away", 2, 2), p("d", "away", 1, 0)], ko("away", 1, 1), S);
    expect(net(s, "a")).toBe(1500);
  });
});

describe("invariants across all settled contests", () => {
  it("every loser pays exactly the stake; Σnet = 0; amounts integral", () => {
    const cases: [Prediction[], Actual][] = [
      [[p("a", "home", 1, 0), p("b", "home", 2, 0), p("c", "home", 3, 0), p("d", "away", 0, 1)], group(2, 0)],
      [[p("a", "home", 2, 1), p("b", "away", 0, 1), p("c", "draw", 1, 1), p("d", "away", 1, 2)], group(2, 0)],
      [[p("a", "home", 3, 1), p("b", "home", 1, 0), p("c", "home", 3, 2), p("d", "home", 2, 0)], group(2, 1)],
    ];
    for (const [preds, actual] of cases) {
      const s = settle(preds, actual, S);
      expect(sumNet(s)).toBe(0);
      for (const t of s.transfers) expect(Number.isInteger(t.amount)).toBe(true);
      const losers = s.results.filter((r) => r.net < 0);
      for (const l of losers) expect(l.net).toBe(-S);
    }
  });
});

describe("dues simplification (Splitwise greedy) — C20", () => {
  it("nets to ≤ N−1 payments that clear every balance", () => {
    const nets = { a: 1000, b: 300, c: -800, d: -500 };
    const tx = simplifyDebts(nets);
    expect(tx.length).toBeLessThanOrEqual(3);
    const settled: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (const t of tx) { settled[t.to] += t.amount; settled[t.from] -= t.amount; }
    expect(settled).toEqual(nets);
  });
});
