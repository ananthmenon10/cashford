// Phase 2 — void precedence rules (plan §3 W1–W2).
// Cases: docs/testing/phase2-cases.md P2-U35–U40.
import { describe, expect, it } from "vitest";
import { settleGameweek } from "../../lib/gameweek-settle";
import { entry, final, input, pick, voidFixture } from "./helpers";

describe("gameweek void precedence (§3 W1-W2)", () => {
  it("P2-U35: 0 entrants → void('no_entrants')", () => {
    const outcome = settleGameweek(input([], [final("f1", 1, 0)], 100));
    expect(outcome).toEqual({ kind: "void", reason: "no_entrants" });
  });

  it("P2-U36: exactly 1 locked_in entry → void('single_entrant'), no transfers", () => {
    const outcome = settleGameweek(input([entry("u1", [pick("f1", 1, 0)])], [final("f1", 1, 0)], 100));
    expect(outcome).toEqual({ kind: "void", reason: "single_entrant" });
  });

  it("P2-U37: all effective fixtures void (≥2 entrants) → void('all_fixtures_void')", () => {
    const outcome = settleGameweek(
      input([entry("u1", [pick("f1", 1, 1)]), entry("u2", [pick("f1", 2, 0)])], [voidFixture("f1")], 100),
    );
    expect(outcome).toEqual({ kind: "void", reason: "all_fixtures_void" });
  });

  it("P2-U38: precedence — 0 entrants AND all fixtures void → no_entrants wins", () => {
    const outcome = settleGameweek(input([], [voidFixture("f1")], 100));
    expect(outcome).toEqual({ kind: "void", reason: "no_entrants" });
  });

  it("P2-U39: precedence — 1 entrant AND all fixtures void → single_entrant wins", () => {
    const outcome = settleGameweek(input([entry("u1", [pick("f1", 1, 1)])], [voidFixture("f1")], 100));
    expect(outcome).toEqual({ kind: "void", reason: "single_entrant" });
  });

  it("P2-U40: 9-of-10 fixtures void, 1 final → settles normally on the 1 remaining fixture", () => {
    const voidIds = Array.from({ length: 9 }, (_, i) => `v${i}`);
    const results = [...voidIds.map(voidFixture), final("f-decider", 1, 0)];
    const picksFor = (h: number, a: number) => [
      ...voidIds.map((fid) => pick(fid, 0, 0)),
      pick("f-decider", h, a),
    ];
    const outcome = settleGameweek(
      input([entry("u1", picksFor(1, 0)), entry("u2", picksFor(0, 1))], results, 100),
    );
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    expect(outcome.winners).toEqual(["u1"]);
    const u1 = outcome.scores.find((s) => s.userId === "u1")!;
    expect(u1.points).toBe(3); // only the 1 final fixture counts
  });
});
