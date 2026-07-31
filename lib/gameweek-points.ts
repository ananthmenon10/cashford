// Cashford gameweek scoring — pure, deterministic (Phase 2 plan §1–§2).
// Given the locked-in entries and the effective fixture results of one gameweek,
// returns each entrant's points, exacts and goal error, plus a per-fixture verdict
// trail. Input is validated strictly: corrupt input throws, it is never guessed at.
// Money and winners live in lib/gameweek-settle.ts.

export type Pick = { fixtureId: string; predHome: number; predAway: number };

export type FixtureResult =
  | { fixtureId: string; state: "final"; home: number; away: number }
  | { fixtureId: string; state: "void" };

export type Entry = { userId: string; picks: Pick[] };

export type GwInput = { entries: Entry[]; results: FixtureResult[]; stakeInr: number };

export type Verdict = "exact" | "result" | "miss" | "void";

export type PerFixtureScore = { fixtureId: string; verdict: Verdict; pts: 0 | 1 | 3 };

export type UserScore = {
  userId: string;
  points: number;
  exacts: number;
  goalError: number;
  perFixture: PerFixtureScore[];
};

// Every rejection is this type, so callers can tell "corrupt input" from a bug.
export class GwInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GwInputError";
  }
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const byAsc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Shape-level checks only (no cross-referencing of picks against results), so the
// void rules in §3 can short-circuit before completeness is demanded.
export function validateGwStructure(input: GwInput): void {
  const { entries, results, stakeInr } = input;

  if (!isInt(stakeInr) || stakeInr <= 0) {
    throw new GwInputError(`stakeInr must be a positive integer, got ${String(stakeInr)}`);
  }

  const seenUsers = new Set<string>();
  for (const e of entries) {
    if (!e.userId) throw new GwInputError("entry is missing userId");
    if (seenUsers.has(e.userId)) throw new GwInputError(`duplicate userId ${e.userId}`);
    seenUsers.add(e.userId);

    const seenPicks = new Set<string>();
    for (const p of e.picks) {
      if (!p.fixtureId) throw new GwInputError(`entry ${e.userId} has a pick with no fixtureId`);
      if (seenPicks.has(p.fixtureId)) {
        throw new GwInputError(`entry ${e.userId} has duplicate picks for fixture ${p.fixtureId}`);
      }
      seenPicks.add(p.fixtureId);
      for (const [field, v] of [["predHome", p.predHome], ["predAway", p.predAway]] as const) {
        if (!isInt(v) || v < 0 || v > 99) {
          throw new GwInputError(
            `entry ${e.userId} fixture ${p.fixtureId}: ${field} must be an integer 0..99, got ${String(v)}`,
          );
        }
      }
    }
  }

  const seenResults = new Set<string>();
  for (const r of results) {
    if (!r.fixtureId) throw new GwInputError("result is missing fixtureId");
    if (seenResults.has(r.fixtureId)) {
      throw new GwInputError(`duplicate result for fixture ${r.fixtureId}`);
    }
    seenResults.add(r.fixtureId);
    if (r.state === "final") {
      for (const [field, v] of [["home", r.home], ["away", r.away]] as const) {
        if (!isInt(v) || v < 0) {
          throw new GwInputError(
            `final result ${r.fixtureId}: ${field} must be a non-negative integer, got ${String(v)}`,
          );
        }
      }
    } else if ((r as FixtureResult).state !== "void") {
      throw new GwInputError(`result ${r.fixtureId} has unknown state ${String(r.state)}`);
    }
  }
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// P1: exact scoreline 3, correct result only 1, else 0. Exact never pays 4.
function gradeFinal(p: Pick, home: number, away: number): PerFixtureScore {
  if (p.predHome === home && p.predAway === away) {
    return { fixtureId: p.fixtureId, verdict: "exact", pts: 3 };
  }
  if (sign(p.predHome - p.predAway) === sign(home - away)) {
    return { fixtureId: p.fixtureId, verdict: "result", pts: 1 };
  }
  return { fixtureId: p.fixtureId, verdict: "miss", pts: 0 };
}

/**
 * Scores every entry against the gameweek's effective results (§0b already
 * collapsed membership history into one state per fixture).
 *
 * Cross-validation (§1/§P4): a counted final fixture with no pick from a
 * locked-in entry is corrupt data and throws; so is a final result no entrant
 * picked. Stale picks (no matching result) are ignored with a diagnostic.
 * Output is sorted by userId asc, and perFixture by fixtureId asc.
 */
export function scoreGameweek(input: GwInput): { scores: UserScore[]; diagnostics: string[] } {
  const { entries, results } = input;
  const resultById = new Map(results.map((r) => [r.fixtureId, r]));
  const finals = results.filter((r): r is Extract<FixtureResult, { state: "final" }> => r.state === "final");
  const voids = results.filter((r) => r.state === "void");
  const diagnostics: string[] = [];

  const pickedFixtures = new Set<string>();
  for (const e of entries) for (const p of e.picks) pickedFixtures.add(p.fixtureId);
  for (const f of [...finals].sort((a, b) => byAsc(a.fixtureId, b.fixtureId))) {
    if (!pickedFixtures.has(f.fixtureId)) {
      throw new GwInputError(`final fixture ${f.fixtureId} was picked by no entrant`);
    }
  }
  for (const v of [...voids].sort((a, b) => byAsc(a.fixtureId, b.fixtureId))) {
    if (!pickedFixtures.has(v.fixtureId)) {
      diagnostics.push(`void fixture ${v.fixtureId} was picked by no entrant`);
    }
  }

  const scores: UserScore[] = [];
  for (const e of [...entries].sort((a, b) => byAsc(a.userId, b.userId))) {
    const pickById = new Map(e.picks.map((p) => [p.fixtureId, p]));

    for (const p of [...e.picks].sort((a, b) => byAsc(a.fixtureId, b.fixtureId))) {
      if (!resultById.has(p.fixtureId)) {
        diagnostics.push(`stale pick ignored: entry ${e.userId} fixture ${p.fixtureId} has no result`);
      }
    }

    const perFixture: PerFixtureScore[] = [];
    let points = 0;
    let exacts = 0;
    let goalError = 0;

    for (const f of finals) {
      const p = pickById.get(f.fixtureId);
      if (!p) {
        throw new GwInputError(`entry ${e.userId} has no pick for counted final fixture ${f.fixtureId}`);
      }
      const row = gradeFinal(p, f.home, f.away);
      perFixture.push(row);
      points += row.pts;
      if (row.verdict === "exact") exacts += 1;
      // P2: void fixtures contribute to none of the three aggregates.
      goalError += Math.abs(p.predHome - f.home) + Math.abs(p.predAway - f.away);
    }

    // A void fixture is a void verdict for everyone, picked or not.
    for (const v of voids) perFixture.push({ fixtureId: v.fixtureId, verdict: "void", pts: 0 });

    perFixture.sort((a, b) => byAsc(a.fixtureId, b.fixtureId));
    scores.push({ userId: e.userId, points, exacts, goalError, perFixture });
  }

  return { scores, diagnostics };
}
