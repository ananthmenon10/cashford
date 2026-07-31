// Phase 3 — D6 membership-history collapse (lib/gw-fixtures.ts). Blind from §2.3 D6.
// Cases: T-U4, T-U4a, T-U4b.
//
// Canonical export per the fix-round report: `collapseGameweekFixtures`. The rule is: any
// active row wins regardless of history order; otherwise void wins; excluded-only history
// disappears. T-U4b below was originally authored asserting the opposite (void beats a later
// excluded return, even with an active row earlier in history) — that was a genuine
// misreading of D6, not a naming guess, and is corrected here per the real rule + the real
// implementation (lib/gw-fixtures.ts:41-43: `history.find(active) ?? history.find(void)`).
import { describe, expect, it } from "vitest";
import { collapseGameweekFixtures } from "../../lib/gw-fixtures";
import { activeFixture, excludedFixtureRow, voidFixtureRow } from "./helpers";

describe("collapseGameweekFixtures — D6 effective state, one collapse for every consumer", () => {
  it("active wins over an older void row for the same fixture_id", () => {
    const rows = [voidFixtureRow("f1", "m1"), activeFixture("f1", "m2")];
    const result = collapseGameweekFixtures(rows);
    expect(result).toHaveLength(1);
    expect(result[0].fixtureId ?? result[0].fixture_id).toBe("f1");
    expect((result[0].effectiveState ?? result[0].state)).toBe("active");
  });

  it("T-U4a: active→void→active collapses to active", () => {
    const rows = [
      activeFixture("f1", "m1"),
      voidFixtureRow("f1", "m2"),
      activeFixture("f1", "m3"),
    ];
    const result = collapseGameweekFixtures(rows);
    expect(result).toHaveLength(1);
    expect((result[0].effectiveState ?? result[0].state)).toBe("active");
  });

  it("T-U4b: active→void→excluded collapses to active (active wins regardless of history order)", () => {
    const rows = [
      activeFixture("f1", "m1"),
      voidFixtureRow("f1", "m2"),
      excludedFixtureRow("f1", "m3"),
    ];
    const result = collapseGameweekFixtures(rows);
    expect(result).toHaveLength(1);
    expect((result[0].effectiveState ?? result[0].state)).toBe("active");
  });

  it("excluded-only history for a fixture_id is ignored entirely — not present in the collapsed output", () => {
    const rows = [excludedFixtureRow("f1", "m1"), excludedFixtureRow("f1", "m2")];
    const result = collapseGameweekFixtures(rows);
    expect(result).toHaveLength(0);
  });

  it("collapses independently per fixture_id — unrelated fixtures don't interact", () => {
    const rows = [activeFixture("f1"), voidFixtureRow("f2"), excludedFixtureRow("f3")];
    const result = collapseGameweekFixtures(rows);
    const byId = new Map(result.map((r: any) => [r.fixtureId ?? r.fixture_id, r.effectiveState ?? r.state]));
    expect(byId.get("f1")).toBe("active");
    expect(byId.get("f2")).toBe("void");
    expect(byId.has("f3")).toBe(false);
  });

  // Truth table: the DB rule (cashford.gameweek_effective_fixtures) is "any active row wins
  // regardless of order; otherwise void wins; excluded-only disappears." This table exercises
  // every permutation of a 3-row history drawn from {active, void, excluded} against a local
  // oracle re-implementation of that rule, proving the TS collapse matches it independent of
  // row order — not just the two orderings spelled out in T-U4a/T-U4b above.
  type State = "active" | "void" | "excluded";
  const BUILD: Record<State, (fixtureId: string, membershipId: string) => ReturnType<typeof activeFixture>> = {
    active: activeFixture,
    void: voidFixtureRow,
    excluded: excludedFixtureRow,
  };

  function oracle(states: State[]): "active" | "void" | undefined {
    if (states.includes("active")) return "active";
    if (states.includes("void")) return "void";
    return undefined;
  }

  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    const out: T[][] = [];
    items.forEach((item, index) => {
      const rest = [...items.slice(0, index), ...items.slice(index + 1)];
      for (const perm of permutations(rest)) out.push([item, ...perm]);
    });
    return out;
  }

  const STATE_SETS: State[][] = [
    ["active", "void", "excluded"],
    ["active", "void"],
    ["active", "excluded"],
    ["void", "excluded"],
    ["excluded", "excluded"],
  ];

  describe("D6 truth table — every permutation of {active, void, excluded} history", () => {
    for (const states of STATE_SETS) {
      for (const order of permutations(states)) {
        const label = order.join("→");
        it(`${label} collapses to ${oracle(order) ?? "(dropped)"}`, () => {
          const rows = order.map((state, index) => BUILD[state]("f1", `m${index}`));
          const result = collapseGameweekFixtures(rows);
          const expected = oracle(order);
          if (expected === undefined) {
            expect(result).toHaveLength(0);
          } else {
            expect(result).toHaveLength(1);
            expect(result[0].effectiveState ?? result[0].state).toBe(expected);
          }
        });
      }
    }
  });
});
