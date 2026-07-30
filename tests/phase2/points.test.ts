// Phase 2 — pure points rules (plan §2 P1–P4).
// Cases: docs/testing/phase2-cases.md P2-U01–U12.
// Driven through settleGameweek (the pure engine's tested entry point — see the interface-
// assumptions note in the delegation report) so a subject entry's per-fixture verdicts are read
// off outcome.scores; a second, deliberately-losing entry is present only to keep the GW
// non-void (W1 needs ≥2 entrants for a 'settled' outcome).
import { describe, expect, it } from "vitest";
import { settleGameweek } from "../../lib/gameweek-settle";
import { entry, final, input, pick, voidFixture } from "./helpers";

function subjectScore(outcome: ReturnType<typeof settleGameweek>, userId = "u1") {
  if (outcome.kind !== "settled") throw new Error("expected settled outcome");
  const s = outcome.scores.find((x) => x.userId === userId);
  if (!s) throw new Error(`${userId} not found in scores`);
  return s;
}

describe("gameweek points (§2)", () => {
  it("P2-U01: exact scoreline on a home win → 3pts, verdict exact", () => {
    const gw = input(
      [entry("u1", [pick("f1", 2, 1)]), entry("u2", [pick("f1", 0, 3)])],
      [final("f1", 2, 1)],
      100,
    );
    const s = subjectScore(settleGameweek(gw));
    expect(s.points).toBe(3);
    expect(s.perFixture).toEqual([{ fixtureId: "f1", verdict: "exact", pts: 3 }]);
  });

  it("P2-U02: exact scoreline on a draw → 3pts", () => {
    const gw = input(
      [entry("u1", [pick("f1", 1, 1)]), entry("u2", [pick("f1", 2, 0)])],
      [final("f1", 1, 1)],
      100,
    );
    expect(subjectScore(settleGameweek(gw)).points).toBe(3);
  });

  it("P2-U03: exact scoreline on an away win → 3pts", () => {
    const gw = input(
      [entry("u1", [pick("f1", 0, 2)]), entry("u2", [pick("f1", 1, 0)])],
      [final("f1", 0, 2)],
      100,
    );
    expect(subjectScore(settleGameweek(gw)).points).toBe(3);
  });

  it("P2-U04: correct result, home win, not exact → 1pt (never 4, exact implies result)", () => {
    const gw = input(
      [entry("u1", [pick("f1", 3, 1)]), entry("u2", [pick("f1", 0, 1)])],
      [final("f1", 2, 0)],
      100,
    );
    const s = subjectScore(settleGameweek(gw));
    expect(s.points).toBe(1);
    expect(s.perFixture[0]).toEqual({ fixtureId: "f1", verdict: "result", pts: 1 });
  });

  it("P2-U05: correct result, away win, not exact → 1pt", () => {
    const gw = input(
      [entry("u1", [pick("f1", 1, 2)]), entry("u2", [pick("f1", 1, 0)])],
      [final("f1", 0, 3)],
      100,
    );
    expect(subjectScore(settleGameweek(gw)).points).toBe(1);
  });

  it("P2-U06: correct result, draw, not exact → 1pt", () => {
    const gw = input(
      [entry("u1", [pick("f1", 2, 2)]), entry("u2", [pick("f1", 2, 0)])],
      [final("f1", 1, 1)],
      100,
    );
    expect(subjectScore(settleGameweek(gw)).points).toBe(1);
  });

  it("P2-U07: wrong sign — predicted away win, actual home win → 0pt, verdict miss", () => {
    const gw = input(
      [entry("u1", [pick("f1", 0, 1)]), entry("u2", [pick("f1", 2, 0)])],
      [final("f1", 2, 0)],
      100,
    );
    const s = subjectScore(settleGameweek(gw));
    expect(s.points).toBe(0);
    expect(s.perFixture[0]).toEqual({ fixtureId: "f1", verdict: "miss", pts: 0 });
  });

  it("P2-U08: wrong sign — predicted home win, actual away win → 0pt", () => {
    const gw = input(
      [entry("u1", [pick("f1", 2, 0)]), entry("u2", [pick("f1", 0, 1)])],
      [final("f1", 0, 1)],
      100,
    );
    expect(subjectScore(settleGameweek(gw)).points).toBe(0);
  });

  it("P2-U09: 0-0 exact scoreline → 3pts (a scoreless exact is never demoted)", () => {
    const gw = input(
      [entry("u1", [pick("f1", 0, 0)]), entry("u2", [pick("f1", 1, 0)])],
      [final("f1", 0, 0)],
      100,
    );
    expect(subjectScore(settleGameweek(gw)).points).toBe(3);
  });

  it("P2-U10: 4-3 exact scoreline → 3pts (exact never awards more than 3, per P1)", () => {
    const gw = input(
      [entry("u1", [pick("f1", 4, 3)]), entry("u2", [pick("f1", 1, 0)])],
      [final("f1", 4, 3)],
      100,
    );
    expect(subjectScore(settleGameweek(gw)).points).toBe(3);
  });

  it("P2-U11: a void fixture is excluded from points, exacts, AND goalError for every entrant (P2)", () => {
    const gw = input(
      [
        entry("u1", [pick("f1", 0, 0), pick("f2", 1, 0)]),
        entry("u2", [pick("f1", 5, 5), pick("f2", 0, 0)]),
      ],
      [voidFixture("f1"), final("f2", 1, 0)],
      100,
    );
    const s = subjectScore(settleGameweek(gw));
    expect(s.points).toBe(3); // only f2 (exact) counts
    expect(s.exacts).toBe(1); // the void fixture never counts as an exact, even trivially
    expect(s.goalError).toBe(0); // f1 excluded entirely; f2 is exact (0 error)
    expect(s.perFixture.find((p) => p.fixtureId === "f1")).toEqual({
      fixtureId: "f1",
      verdict: "void",
      pts: 0,
    });
  });

  it("P2-U12: a stale pick with no matching result scores nothing and is diagnosed, not thrown (P4)", () => {
    const gw = input(
      [entry("u1", [pick("f1", 1, 0), pick("f3", 9, 9)]), entry("u2", [pick("f1", 0, 1)])],
      [final("f1", 1, 0)], // f3 has no result — e.g. the fixture left the GW
      100,
    );
    const outcome = settleGameweek(gw);
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    const s = outcome.scores.find((x) => x.userId === "u1")!;
    expect(s.points).toBe(3); // only f1 counts
    expect(outcome.diagnostics.some((d) => d.includes("f3"))).toBe(true);
  });
});
