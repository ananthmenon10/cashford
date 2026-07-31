// Phase 2 — pure money rules (plan §4 M1–M5).
// Cases: docs/testing/phase2-cases.md P2-U28–U33. U33 is the 500-random-gameweek property test
// (folded in here per the delegation brief's "money" bucket rather than a separate file).
import { describe, expect, it } from "vitest";
import { settleGameweek } from "../../lib/gameweek-settle";
import { entry, final, input, pick } from "./helpers";

// N winners exact on f1 (home win 2-0), M losers wrong-sign miss on the same fixture — a cheap
// way to produce an exact winner count without depending on tiebreak internals.
function tiedField(winners: number, losers: number) {
  const entries = [
    ...Array.from({ length: winners }, (_, i) => entry(`w${i}`, [pick("f1", 2, 0)])),
    ...Array.from({ length: losers }, (_, i) => entry(`l${i}`, [pick("f1", 0, 1)])),
  ];
  return { entries, results: [final("f1", 2, 0)] };
}

describe("gameweek money rules (§4)", () => {
  it("P2-U28: 2 entrants — winner pays nothing, loser pays exactly stake (M1)", () => {
    const { entries, results } = tiedField(1, 1);
    const outcome = settleGameweek(input(entries, results, 100));
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    expect(outcome.transfers).toEqual([{ fromUserId: "l0", toUserId: "w0", amountInr: 100 }]);
    expect(outcome.potInr).toBe(200); // stake × entrantCount, display only (M1)
  });

  it("P2-U29: 7 entrants, single winner receives stake × loserCount (M2)", () => {
    const { entries, results } = tiedField(1, 6);
    const outcome = settleGameweek(input(entries, results, 50));
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    expect(outcome.transfers).toHaveLength(6);
    expect(outcome.transfers.every((t) => t.toUserId === "w0" && t.amountInr === 50)).toBe(true);
    expect(outcome.transfers.reduce((s, t) => s + t.amountInr, 0)).toBe(300);
    expect(outcome.potInr).toBe(350);
  });

  it("P2-U30: split among 3 winners with a remainder — first winners by userId asc get the extra rupee (M3)", () => {
    const { entries, results } = tiedField(3, 1);
    const outcome = settleGameweek(input(entries, results, 100));
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    const byWinner = Object.fromEntries(outcome.transfers.map((t) => [t.toUserId, t.amountInr]));
    expect(byWinner).toEqual({ w0: 34, w1: 33, w2: 33 }); // base 33, remainder 1 → w0 (asc) gets it
    expect(outcome.transfers.reduce((s, t) => s + t.amountInr, 0)).toBe(100); // loser pays exactly stake
  });

  it("P2-U31: k > stake — base is 0, only remainder winners are paid (M3)", () => {
    const { entries, results } = tiedField(3, 1);
    const outcome = settleGameweek(input(entries, results, 2));
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    const byWinner = Object.fromEntries(outcome.transfers.map((t) => [t.toUserId, t.amountInr]));
    expect(byWinner).toEqual({ w0: 1, w1: 1 }); // base 0, remainder 2 → only w0, w1 paid
    expect(outcome.transfers.reduce((s, t) => s + t.amountInr, 0)).toBe(2);
  });

  it("P2-U32: zero-value transfer rows are omitted, not emitted as amountInr 0 (M3)", () => {
    const { entries, results } = tiedField(4, 1);
    const outcome = settleGameweek(input(entries, results, 2));
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    expect(outcome.transfers).toHaveLength(2); // 4 winners, only 2 (remainder) get a nonzero share
    expect(outcome.transfers.every((t) => t.amountInr > 0)).toBe(true);
  });

  it("P2-U33: property — 500 random gameweeks all conserve money (M3 invariants)", () => {
    // Seeded PRNG (mulberry32) so the run is deterministic across CI — no flake from Math.random.
    let s = 0x2f6e2b1;
    const rand = () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

    for (let iter = 0; iter < 500; iter++) {
      const entrantCount = randInt(2, 8);
      const fixtureCount = randInt(1, 5);
      const stakeInr = randInt(1, 500);
      const fixtureIds = Array.from({ length: fixtureCount }, (_, i) => `f${i}`);
      const results = fixtureIds.map((fid) => final(fid, randInt(0, 5), randInt(0, 5)));
      const entries = Array.from({ length: entrantCount }, (_, i) =>
        entry(
          `u${i}`,
          fixtureIds.map((fid) => pick(fid, randInt(0, 5), randInt(0, 5))),
        ),
      );

      const outcome = settleGameweek(input(entries, results, stakeInr));
      if (outcome.kind !== "settled") throw new Error(`iter ${iter}: expected settled outcome`);

      const winnerSet = new Set(outcome.winners);
      const loserCount = entrantCount - winnerSet.size;
      const net = new Map<string, number>(entries.map((e) => [e.userId, 0]));
      for (const t of outcome.transfers) {
        expect(Number.isInteger(t.amountInr)).toBe(true);
        expect(t.amountInr).toBeGreaterThan(0);
        net.set(t.fromUserId, net.get(t.fromUserId)! - t.amountInr);
        net.set(t.toUserId, net.get(t.toUserId)! + t.amountInr);
      }
      expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0); // Σnet = 0

      for (const userId of net.keys()) {
        if (!winnerSet.has(userId)) {
          expect(-net.get(userId)!).toBe(stakeInr); // each loser pays exactly stake
        }
      }
      const total = outcome.transfers.reduce((a, t) => a + t.amountInr, 0);
      expect(total).toBe(stakeInr * loserCount); // total transferred = stake × losers
    }
  });
});
