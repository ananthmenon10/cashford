// Phase 2 — pure input validation (plan §1: "throws, never guesses").
// Cases: docs/testing/phase2-cases.md P2-U13–U18b.
import { describe, expect, it } from "vitest";
import { settleGameweek } from "../../lib/gameweek-settle";
import { entry, final, input, pick } from "./helpers";

describe("gameweek input validation (§1)", () => {
  it("P2-U13: a locked_in entry missing a pick for a counted final fixture throws", () => {
    const gw = input(
      [
        entry("u1", [pick("f1", 1, 0)]), // missing f2
        entry("u2", [pick("f1", 1, 0), pick("f2", 0, 1)]),
      ],
      [final("f1", 1, 0), final("f2", 0, 1)],
      100,
    );
    expect(() => settleGameweek(gw)).toThrow();
  });

  it("P2-U14: a duplicate fixtureId in results throws", () => {
    const gw = input(
      [entry("u1", [pick("f1", 1, 0)]), entry("u2", [pick("f1", 1, 0)])],
      [final("f1", 1, 0), final("f1", 2, 0)],
      100,
    );
    expect(() => settleGameweek(gw)).toThrow();
  });

  it("P2-U15: a duplicate userId across entries throws", () => {
    const gw = input(
      [entry("u1", [pick("f1", 1, 0)]), entry("u1", [pick("f1", 0, 1)])],
      [final("f1", 1, 0)],
      100,
    );
    expect(() => settleGameweek(gw)).toThrow();
  });

  it("P2-U16: a final result missing a score throws", () => {
    const gw = input(
      [entry("u1", [pick("f1", 1, 0)]), entry("u2", [pick("f1", 0, 1)])],
      [{ fixtureId: "f1", state: "final", home: 2 } as any], // away score missing
      100,
    );
    expect(() => settleGameweek(gw)).toThrow();
  });

  it("P2-U17: a non-integer, zero, or negative stake throws (positive-integer rule)", () => {
    const base = input(
      [entry("u1", [pick("f1", 1, 0)]), entry("u2", [pick("f1", 0, 1)])],
      [final("f1", 1, 0)],
      100,
    );
    expect(() => settleGameweek({ ...base, stakeInr: 100.5 })).toThrow();
    expect(() => settleGameweek({ ...base, stakeInr: 0 })).toThrow();
    expect(() => settleGameweek({ ...base, stakeInr: -50 })).toThrow();
  });

  it("P2-U18: a prediction outside 0..99, or non-integer, throws", () => {
    const mk = (h: number, a: number) =>
      input(
        [entry("u1", [pick("f1", h, a)]), entry("u2", [pick("f1", 0, 1)])],
        [final("f1", 1, 0)],
        100,
      );
    expect(() => settleGameweek(mk(100, 0))).toThrow(); // out of range, high
    expect(() => settleGameweek(mk(-1, 0))).toThrow(); // negative
    expect(() => settleGameweek(mk(1.5, 0))).toThrow(); // non-integer
  });

  it("P2-U18b: a duplicate fixtureId within one entry's own picks throws", () => {
    const gw = input(
      [entry("u1", [pick("f1", 1, 0), pick("f1", 2, 0)]), entry("u2", [pick("f1", 0, 1)])],
      [final("f1", 1, 0)],
      100,
    );
    expect(() => settleGameweek(gw)).toThrow();
  });
});
