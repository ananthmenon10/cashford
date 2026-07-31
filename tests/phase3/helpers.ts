// Phase 3 — shared builders for the core-UI test suites.
// Field names follow the plan's own vocabulary verbatim (docs/plans/2026-07-27-006, §5.1/§5.2):
// the plan writes every lifecycle/participation rule in terms of `gameweek_contests.status`,
// `deadline_at`, `input_version`, `gameweek_results.outcome`, `settled_version`, `void_reason`,
// `tiebreak_used`, `last_settle_cause`, `member_competitions.eligible_from_gameweek_id`,
// `left_at`, `gameweek_entries.status`. This file is a restatement of that vocabulary as
// builders, not a guess at the implementation's internal shape — if `resolveContestLifecycle`
// et al. take a differently-shaped DTO, the tests fail on shape mismatch, which is a real
// finding, not noise.
//
// No fixed "now" constant is baked in here — every test passes its own `now` explicitly, per
// case, because CL/VP resolution is defined entirely in terms of `deadline_at <= now`.

// NOTE: `status`/`deadlineAt`/`inputVersion` are camelCase to match lib/gw-state.ts's
// `LifecycleContest` type (the fix round moved that type to camelCase-only fields). The other
// fields here are unused by `resolveContestLifecycle` and kept snake_case as a reminder of the
// real DB row shape they're standing in for.
export type ContestRow = {
  id: string;
  league_id: string;
  gameweek_id: string;
  status: "open" | "locked" | "settling" | "settled" | "void";
  stake_inr: number;
  deadlineAt: string; // ISO instant
  inputVersion: number;
};

export type GwRow = {
  id: string;
  competition_id: string;
  number: number;
  name?: string;
  status: "upcoming" | "open" | "locked" | "completed";
  deadline_at: string;
};

export type FixtureMembershipRow = {
  id: string; // gameweek_fixtures.id (history row, not the fixture)
  gameweek_id: string;
  fixture_id: string;
  state: "active" | "void" | "excluded";
};

// `voidReason`/`settledVersion` are camelCase to match lib/gw-state.ts's `LifecycleResult` type.
export type ResultsRow = {
  gameweek_contest_id: string;
  outcome: "settled" | "void";
  voidReason?: "no_entrants" | "single_entrant" | "all_fixtures_void" | null;
  tiebreak_used?: "none" | "exacts" | "goalError" | "split" | null;
  settledVersion: number;
  last_settle_cause: "initial" | "result_revision" | "membership_change" | "combined";
} | null;

export const contest = (overrides: Partial<ContestRow> = {}): ContestRow => ({
  id: "contest-1",
  league_id: "league-1",
  gameweek_id: "gw-1",
  status: "open",
  stake_inr: 200,
  deadlineAt: "2026-02-03T10:30:00.000Z",
  inputVersion: 0,
  ...overrides,
});

export const gw = (overrides: Partial<GwRow> = {}): GwRow => ({
  id: "gw-1",
  competition_id: "comp-pl",
  number: 24,
  status: "open",
  deadline_at: "2026-02-03T10:30:00.000Z",
  ...overrides,
});

export const activeFixture = (fixtureId: string, membershipId = `${fixtureId}-active`): FixtureMembershipRow => ({
  id: membershipId,
  gameweek_id: "gw-1",
  fixture_id: fixtureId,
  state: "active",
});

export const voidFixtureRow = (fixtureId: string, membershipId = `${fixtureId}-void`): FixtureMembershipRow => ({
  id: membershipId,
  gameweek_id: "gw-1",
  fixture_id: fixtureId,
  state: "void",
});

export const excludedFixtureRow = (fixtureId: string, membershipId = `${fixtureId}-excluded`): FixtureMembershipRow => ({
  id: membershipId,
  gameweek_id: "gw-1",
  fixture_id: fixtureId,
  state: "excluded",
});

export const settledResult = (overrides: Partial<NonNullable<ResultsRow>> = {}): ResultsRow => ({
  gameweek_contest_id: "contest-1",
  outcome: "settled",
  tiebreak_used: "none",
  settledVersion: 0,
  last_settle_cause: "initial",
  ...overrides,
});

export const voidResult = (overrides: Partial<NonNullable<ResultsRow>> = {}): ResultsRow => ({
  gameweek_contest_id: "contest-1",
  outcome: "void",
  voidReason: "no_entrants",
  tiebreak_used: null,
  settledVersion: 0,
  last_settle_cause: "initial",
  ...overrides,
});

// A finished fixture with scores, for the "fixture readiness" dimension of the CL tree.
export type FinalScoreRow = { fixture_id: string; status: "finished" | "live" | "scheduled"; home?: number; away?: number };
export const finished = (fixtureId: string, home = 1, away = 0): FinalScoreRow => ({
  fixture_id: fixtureId,
  status: "finished",
  home,
  away,
});
export const notFinished = (fixtureId: string): FinalScoreRow => ({ fixture_id: fixtureId, status: "live" });

export type MemberRow = {
  left_at: string | null;
  league_eligible_from_number: number | null; // resolved gameweek number, not the raw uuid (D5)
  member_eligible_from_number: number | null;
};

export const member = (overrides: Partial<MemberRow> = {}): MemberRow => ({
  left_at: null,
  league_eligible_from_number: 1,
  member_eligible_from_number: 1,
  ...overrides,
});

export type EntryRow = { status: "entered" | "needs_update" | "locked_in" | "invalid" } | null;
export const entryRow = (status: EntryRow extends null ? never : NonNullable<EntryRow>["status"]): EntryRow => ({
  status,
});

// `resolveContestLifecycle(contest, gw, fixtures, results, now)` — §5.1's tree is defined
// entirely in terms of the D6-collapsed effective fixture state (active/void; excluded is
// already dropped by the collapse) plus each active fixture's readiness. There is no separate
// "final scores" parameter in the signature the plan gives, so `fixtures` is assumed to be that
// collapsed, readiness-annotated array — this is an interpretation (flagged in the delegation
// report), not a literal quote from the plan.
export type EffectiveFixture = { fixtureId: string; effectiveState: "active" | "void"; final: boolean };
export const activeFinal = (fixtureId: string): EffectiveFixture => ({
  fixtureId,
  effectiveState: "active",
  final: true,
});
export const activeLive = (fixtureId: string): EffectiveFixture => ({
  fixtureId,
  effectiveState: "active",
  final: false,
});
export const voidEff = (fixtureId: string): EffectiveFixture => ({
  fixtureId,
  effectiveState: "void",
  final: false,
});
