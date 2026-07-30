// Cashford gameweek settlement — pure, deterministic (Phase 2 plan §3–§4).
// Turns one gameweek's locked-in entries + effective fixture results into the
// outcome the DB layer persists: winners, per-entry nets, and directed
// loser→winner transfers. The math lives here and nowhere else.
// Invariants: every loser pays exactly `stake`; Σ(net) = 0; every emitted amount
// is a positive integer (same convention as lib/settlement.ts).

import {
  GwInputError,
  scoreGameweek,
  validateGwStructure,
  type GwInput,
  type UserScore,
} from "./gameweek-points";

export type TiebreakUsed = "none" | "exacts" | "goalError" | "split";

export type GwTransfer = { fromUserId: string; toUserId: string; amountInr: number };

export type GwOutcome =
  | {
      kind: "settled";
      scores: UserScore[];
      winners: string[];
      potInr: number;
      transfers: GwTransfer[];
      tiebreakUsed: TiebreakUsed;
      diagnostics: string[];
    }
  | { kind: "void"; reason: "no_entrants" | "single_entrant" | "all_fixtures_void" };

const byAsc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// W3–W6: max points, then max exacts, then min goalError, then split.
function pickWinners(scores: UserScore[]): { winners: UserScore[]; tiebreakUsed: TiebreakUsed } {
  const best = (pool: UserScore[], key: (s: UserScore) => number, dir: 1 | -1) => {
    const target = pool.reduce((m, s) => (dir * key(s) > dir * m ? key(s) : m), key(pool[0]));
    return pool.filter((s) => key(s) === target);
  };

  let pool = best(scores, (s) => s.points, 1);
  if (pool.length === 1) return { winners: pool, tiebreakUsed: "none" };

  pool = best(pool, (s) => s.exacts, 1);
  if (pool.length === 1) return { winners: pool, tiebreakUsed: "exacts" };

  pool = best(pool, (s) => s.goalError, -1);
  if (pool.length === 1) return { winners: pool, tiebreakUsed: "goalError" };

  // W6: everyone left splits — including the all-entrants-tie case, where the
  // winner set is the whole field and no money moves.
  return { winners: pool, tiebreakUsed: "split" };
}

// M3: split PER LOSER. Each loser pays exactly `stake`, divided floor(stake/k)
// with the leftover ₹1s going to the first winners by userId. Zero rows dropped.
function buildTransfers(winnerIds: string[], loserIds: string[], stakeInr: number): GwTransfer[] {
  const k = winnerIds.length;
  const base = Math.floor(stakeInr / k);
  const rem = stakeInr - base * k;

  const transfers: GwTransfer[] = [];
  for (const from of [...loserIds].sort(byAsc)) {
    winnerIds.forEach((to, idx) => {
      const amountInr = base + (idx < rem ? 1 : 0);
      if (amountInr > 0) transfers.push({ fromUserId: from, toUserId: to, amountInr });
    });
  }
  return transfers;
}

function assertMoneyInvariants(
  transfers: GwTransfer[],
  winnerIds: string[],
  loserIds: string[],
  stakeInr: number,
): void {
  let total = 0;
  const out = new Map<string, number>(loserIds.map((id) => [id, 0]));
  const winnerSet = new Set(winnerIds);
  for (const t of transfers) {
    if (!Number.isInteger(t.amountInr) || t.amountInr <= 0) {
      throw new Error(`gameweek settle: non-positive-integer transfer ${t.amountInr}`);
    }
    if (!out.has(t.fromUserId)) throw new Error(`gameweek settle: transfer from non-loser ${t.fromUserId}`);
    if (!winnerSet.has(t.toUserId)) throw new Error(`gameweek settle: transfer to non-winner ${t.toUserId}`);
    out.set(t.fromUserId, out.get(t.fromUserId)! + t.amountInr);
    total += t.amountInr;
  }
  for (const [id, paid] of out) {
    if (paid !== stakeInr) {
      throw new Error(`gameweek settle: loser ${id} paid ${paid}, expected ${stakeInr}`);
    }
  }
  if (total !== stakeInr * loserIds.length) {
    throw new Error(`gameweek settle: transferred ${total}, expected ${stakeInr * loserIds.length}`);
  }
}

/**
 * The whole pure engine: validate, apply the void rules, score, pick winners,
 * move the money. Throws GwInputError on corrupt input (never guesses).
 * Outputs are sorted (userId asc, fixtureId asc, transfers by from then to).
 */
export function settleGameweek(input: GwInput): GwOutcome {
  validateGwStructure(input);

  // W1/W2 precedence: no_entrants > single_entrant > all_fixtures_void, and the
  // entrant-count voids fire at lock without waiting for any result.
  if (input.entries.length === 0) return { kind: "void", reason: "no_entrants" };
  if (input.entries.length === 1) return { kind: "void", reason: "single_entrant" };
  if (input.results.length > 0 && input.results.every((r) => r.state === "void")) {
    return { kind: "void", reason: "all_fixtures_void" };
  }
  if (input.results.length === 0) {
    throw new GwInputError("gameweek has no fixture results — a contest with entrants cannot have zero fixtures");
  }

  const { scores, diagnostics } = scoreGameweek(input);
  const { winners, tiebreakUsed } = pickWinners(scores);

  const winnerIds = winners.map((w) => w.userId).sort(byAsc);
  const winnerSet = new Set(winnerIds);
  const loserIds = scores.map((s) => s.userId).filter((id) => !winnerSet.has(id)).sort(byAsc);

  const transfers = buildTransfers(winnerIds, loserIds, input.stakeInr);
  assertMoneyInvariants(transfers, winnerIds, loserIds, input.stakeInr);

  return {
    kind: "settled",
    scores,
    winners: winnerIds,
    potInr: input.stakeInr * scores.length, // M1: gross pot metadata (display only)
    transfers: transfers.sort((a, b) => byAsc(a.fromUserId, b.fromUserId) || byAsc(a.toUserId, b.toUserId)),
    tiebreakUsed,
    diagnostics,
  };
}

/** Per-entry net (₹) implied by an outcome's transfers; Σ over all entrants is 0. */
export function gameweekNets(outcome: Extract<GwOutcome, { kind: "settled" }>): Map<string, number> {
  const net = new Map<string, number>(outcome.scores.map((s) => [s.userId, 0]));
  for (const t of outcome.transfers) {
    net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) - t.amountInr);
    net.set(t.toUserId, (net.get(t.toUserId) ?? 0) + t.amountInr);
  }
  return net;
}
