// Phase 2 — winner + tiebreak rules (plan §3 W1–W7).
// Cases: docs/testing/phase2-cases.md P2-U19–U27.
// Void precedence (W1/W2) has its own suite: tests/phase2/void.test.ts.
import { describe, expect, it } from "vitest";
import { settleGameweek } from "../../lib/gameweek-settle";
import { entry, final, input, pick } from "./helpers";

describe("gameweek winner / tiebreak rules (§3)", () => {
  it("P2-U19: unique max points (W3) → single winner, tiebreakUsed 'none'", () => {
    const outcome = settleGameweek(
      input([entry("u1", [pick("f1", 2, 0)]), entry("u2", [pick("f1", 1, 0)])], [final("f1", 2, 0)], 100),
    );
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    expect(outcome.winners).toEqual(["u1"]);
    expect(outcome.tiebreakUsed).toBe("none");
  });

  it("P2-U20: equal points, exacts breaks a 2-way tie (W4)", () => {
    const outcome = settleGameweek(
      input(
        [
          entry("u1", [pick("f1", 2, 0), pick("f2", 1, 0), pick("f3", 0, 1)]),
          entry("u2", [pick("f1", 3, 1), pick("f2", 2, 2), pick("f3", 1, 0)]),
        ],
        [final("f1", 2, 0), final("f2", 1, 1), final("f3", 4, 1)],
        100,
      ),
    );
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    const u1 = outcome.scores.find((s) => s.userId === "u1")!;
    const u2 = outcome.scores.find((s) => s.userId === "u2")!;
    expect(u1.points).toBe(3);
    expect(u2.points).toBe(3);
    expect(u1.exacts).toBe(1);
    expect(u2.exacts).toBe(0);
    expect(outcome.winners).toEqual(["u1"]);
    expect(outcome.tiebreakUsed).toBe("exacts");
  });

  it("P2-U21: 3-way tie at points narrows via exacts (W4), then goalError decides between the survivors (W5)", () => {
    const outcome = settleGameweek(
      input(
        [
          entry("u1", [pick("f1", 2, 0), pick("f2", 2, 0), pick("f3", 1, 1)]),
          entry("u2", [pick("f1", 1, 1), pick("f2", 1, 1), pick("f3", 1, 0)]),
          entry("u3", [pick("f1", 1, 0), pick("f2", 2, 2), pick("f3", 0, 3)]),
        ],
        [final("f1", 2, 0), final("f2", 1, 1), final("f3", 0, 2)],
        100,
      ),
    );
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    const [u1, u2, u3] = ["u1", "u2", "u3"].map((id) => outcome.scores.find((s) => s.userId === id)!);
    expect(u1.points).toBe(3);
    expect(u2.points).toBe(3);
    expect(u3.points).toBe(3);
    expect(u1.exacts).toBe(1);
    expect(u2.exacts).toBe(1);
    expect(u3.exacts).toBe(0); // eliminated at W4, never reaches goalError
    expect(u1.goalError).toBeLessThan(u2.goalError); // W5 decides between the two exacts-tied survivors
    expect(outcome.winners).toEqual(["u1"]);
    expect(outcome.tiebreakUsed).toBe("goalError");
  });

  it("P2-U22: equal points and exacts (both 0), goalError breaks the 2-way tie (W5)", () => {
    const outcome = settleGameweek(
      input(
        [
          entry("u1", [pick("f1", 3, 1), pick("f2", 2, 2)]),
          entry("u2", [pick("f1", 1, 0), pick("f2", 3, 3)]),
        ],
        [final("f1", 2, 0), final("f2", 1, 1)],
        100,
      ),
    );
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    const u1 = outcome.scores.find((s) => s.userId === "u1")!;
    const u2 = outcome.scores.find((s) => s.userId === "u2")!;
    expect(u1.points).toBe(2);
    expect(u2.points).toBe(2);
    expect(u1.exacts).toBe(0);
    expect(u2.exacts).toBe(0);
    expect(u1.goalError).toBeLessThan(u2.goalError);
    expect(outcome.winners).toEqual(["u1"]);
    expect(outcome.tiebreakUsed).toBe("goalError");
  });

  it("P2-U23: every tiebreak exhausted (equal points, exacts, goalError) → split (W6)", () => {
    const outcome = settleGameweek(
      input(
        [
          entry("u1", [pick("f1", 3, 1)]),
          entry("u2", [pick("f1", 4, 0)]), // different scoreline, same closeness (goalError 2)
          entry("u3", [pick("f1", 0, 1)]), // clear loser
        ],
        [final("f1", 2, 0)],
        100,
      ),
    );
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    expect(outcome.winners.slice().sort()).toEqual(["u1", "u2"]);
    expect(outcome.tiebreakUsed).toBe("split");
  });

  it("P2-U24: a 3-way tie that survives every criterion → tiebreakUsed 'split'", () => {
    const outcome = settleGameweek(
      input(
        [
          entry("u1", [pick("f1", 2, 0)]),
          entry("u2", [pick("f1", 2, 0)]),
          entry("u3", [pick("f1", 2, 0)]),
          entry("u4", [pick("f1", 0, 1)]), // clear loser
        ],
        [final("f1", 2, 0)],
        100,
      ),
    );
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    expect(outcome.winners.slice().sort()).toEqual(["u1", "u2", "u3"]);
    expect(outcome.tiebreakUsed).toBe("split");
  });

  it("P2-U25: everyone scores 0 points — tiebreak still selects the closest wrong prediction via goalError (W7)", () => {
    const outcome = settleGameweek(
      input(
        [entry("u1", [pick("f1", 0, 1)]), entry("u2", [pick("f1", 0, 2)])],
        [final("f1", 3, 0)],
        100,
      ),
    );
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    const u1 = outcome.scores.find((s) => s.userId === "u1")!;
    const u2 = outcome.scores.find((s) => s.userId === "u2")!;
    expect(u1.points).toBe(0);
    expect(u2.points).toBe(0);
    expect(outcome.winners).toEqual(["u1"]);
    expect(outcome.tiebreakUsed).toBe("goalError");
  });

  it("P2-U26: two entrants with literally identical picks are guaranteed to split against a loser", () => {
    const outcome = settleGameweek(
      input(
        [
          entry("u1", [pick("f1", 3, 1)]),
          entry("u2", [pick("f1", 3, 1)]), // identical to u1's pick
          entry("u3", [pick("f1", 0, 1)]), // loser
        ],
        [final("f1", 2, 0)],
        100,
      ),
    );
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    expect(outcome.winners.slice().sort()).toEqual(["u1", "u2"]);
    expect(outcome.tiebreakUsed).toBe("split");
  });

  it("P2-U27: ALL entrants tie → everyone wins, zero transfers (W6, explicitly legal)", () => {
    const outcome = settleGameweek(
      input(
        [
          entry("u1", [pick("f1", 3, 1)]),
          entry("u2", [pick("f1", 3, 1)]),
          entry("u3", [pick("f1", 3, 1)]),
        ],
        [final("f1", 2, 0)],
        100,
      ),
    );
    if (outcome.kind !== "settled") throw new Error("expected settled outcome");
    expect(outcome.winners.slice().sort()).toEqual(["u1", "u2", "u3"]);
    expect(outcome.transfers).toEqual([]);
  });
});
