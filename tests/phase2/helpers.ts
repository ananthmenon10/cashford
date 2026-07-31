// Phase 2 — shared builders for the pure gameweek engine test suites.
// Shapes mirror plan §1 (docs/plans/2026-07-27-005-phase2-engine-plan.md) exactly; these are
// just short-hand constructors so each case-doc row maps to a one-line call. No type import from
// the implementation — §1's code block is the contract, this file restates it locally.
export type Pick = { fixtureId: string; predHome: number; predAway: number };
export type FixtureResult =
  | { fixtureId: string; state: "final"; home: number; away: number }
  | { fixtureId: string; state: "void" };
export type Entry = { userId: string; picks: Pick[] };
export type GwInput = { entries: Entry[]; results: FixtureResult[]; stakeInr: number };

export const pick = (fixtureId: string, predHome: number, predAway: number): Pick => ({
  fixtureId,
  predHome,
  predAway,
});
export const entry = (userId: string, picks: Pick[]): Entry => ({ userId, picks });
export const final = (fixtureId: string, home: number, away: number): FixtureResult => ({
  fixtureId,
  state: "final",
  home,
  away,
});
export const voidFixture = (fixtureId: string): FixtureResult => ({ fixtureId, state: "void" });
export const input = (entries: Entry[], results: FixtureResult[], stakeInr: number): GwInput => ({
  entries,
  results,
  stakeInr,
});
