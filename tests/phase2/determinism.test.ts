// Phase 2 — deterministic output ordering (plan §1: "Outputs (scores, winners, transfers) are
// deterministically sorted (userId asc, fixtureId asc) before returning").
// Cases: docs/testing/phase2-cases.md P2-U34.
import { describe, expect, it } from "vitest";
import { settleGameweek } from "../../lib/gameweek-settle";
import { entry, final, input, pick } from "./helpers";

describe("gameweek deterministic ordering (§1)", () => {
  it("P2-U34: scores/perFixture order is stable (userId asc, fixtureId asc) regardless of input order", () => {
    const results = [final("f1", 2, 0), final("f2", 1, 1)];
    const picksFor = (h1: number, a1: number, h2: number, a2: number) => [
      pick("f1", h1, a1),
      pick("f2", h2, a2),
    ];

    const forward = input(
      [
        entry("c-user", picksFor(2, 0, 1, 1)),
        entry("a-user", picksFor(0, 1, 2, 2)),
        entry("b-user", picksFor(1, 0, 1, 1)),
      ],
      results,
      100,
    );
    const shuffled = input([...forward.entries].reverse(), [...forward.results].reverse(), 100);

    const outcomeA = settleGameweek(forward);
    const outcomeB = settleGameweek(shuffled);
    if (outcomeA.kind !== "settled" || outcomeB.kind !== "settled") {
      throw new Error("expected settled outcomes");
    }

    expect(outcomeA.scores.map((s) => s.userId)).toEqual(["a-user", "b-user", "c-user"]);
    expect(outcomeB.scores.map((s) => s.userId)).toEqual(["a-user", "b-user", "c-user"]);
    expect(outcomeA).toEqual(outcomeB); // input order never leaks into the output

    for (const s of outcomeA.scores) {
      expect(s.perFixture.map((p) => p.fixtureId)).toEqual(["f1", "f2"]); // fixtureId asc
    }
  });
});
