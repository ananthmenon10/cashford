// Cashford settlement engine — pure, deterministic (plan §7.4 + §17.1).
// Given the entrants' predictions, the actual result, and the stake, returns
// who won/lost, each player's net (₹), and the directed loser→winner transfers.
// Invariants: every loser pays exactly `stake`; Σ(transfers in) = Σ(out);
// Σ(net) = 0; all amounts are whole rupees.

export type Outcome = "home" | "draw" | "away";

export interface Prediction {
  userId: string;
  outcome: Outcome;
  predHome: number;
  predAway: number;
}

export interface Actual {
  isKnockout: boolean;
  ftHome: number; // end-of-regulation (90') score — the grading scoreline
  ftAway: number;
  advancer?: "home" | "away"; // knockout only
}

export type ResultKind = "win" | "loss" | "push" | "void";
export interface PlayerResult { userId: string; result: ResultKind; net: number; }
export interface Transfer { from: string; to: string; amount: number; }
export interface Settlement {
  status: "settled" | "void";
  voidReason?: "insufficient_entries" | "no_separation";
  results: PlayerResult[];
  transfers: Transfer[];
}

function actualOutcome(a: Actual): Outcome {
  if (a.isKnockout) return a.advancer === "home" ? "home" : "away";
  if (a.ftHome > a.ftAway) return "home";
  if (a.ftHome < a.ftAway) return "away";
  return "draw";
}

// Layered closeness key (§7.7); lower is better, compared lexicographically.
function scoreKey(p: Prediction, aH: number, aA: number): number[] {
  const exact = p.predHome === aH && p.predAway === aA ? 0 : 1;
  const totalErr = Math.abs(p.predHome - aH) + Math.abs(p.predAway - aA);
  const marginErr = Math.abs(p.predHome - p.predAway - (aH - aA));
  const totalGoalsErr = Math.abs(p.predHome + p.predAway - (aH + aA));
  return [exact, totalErr, marginErr, totalGoalsErr];
}
const cmpKey = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

function voidAll(preds: Prediction[], reason: Settlement["voidReason"]): Settlement {
  return {
    status: "void",
    voidReason: reason,
    results: preds.map((p) => ({ userId: p.userId, result: "void", net: 0 })),
    transfers: [],
  };
}

export function settle(preds: Prediction[], actual: Actual, stake: number): Settlement {
  const N = preds.length;
  if (N < 2) return voidAll(preds, "insufficient_entries");

  const ao = actualOutcome(actual);
  const correct = preds.filter((p) => p.outcome === ao);

  let winners: Prediction[];
  if (correct.length > 0 && correct.length < N) {
    // Outcome splits the field → correct-outcome players win; scoreline ignored.
    winners = correct;
  } else {
    // No split (everyone right, or nobody right) → layered scoreline tiebreak.
    const keyed = preds.map((p) => ({ p, k: scoreKey(p, actual.ftHome, actual.ftAway) }));
    const minKey = keyed.reduce((m, x) => (cmpKey(x.k, m) < 0 ? x.k : m), keyed[0].k);
    winners = keyed.filter((x) => cmpKey(x.k, minKey) === 0).map((x) => x.p);
    if (winners.length === N) return voidAll(preds, "no_separation");
  }

  const winnerIds = new Set(winners.map((w) => w.userId));
  const losers = preds.filter((p) => !winnerIds.has(p.userId));

  // Deterministic remainder distribution: each loser pays `stake`, split among
  // winners as floor(stake/W) with the leftover ₹1s going to the first winners
  // by userId. Keeps every amount integral and conserves the pot.
  const wSorted = [...winners].sort((a, b) => (a.userId < b.userId ? -1 : 1));
  const W = wSorted.length;
  const base = Math.floor(stake / W);
  const rem = stake - base * W;

  const transfers: Transfer[] = [];
  for (const l of losers) {
    wSorted.forEach((w, idx) => {
      transfers.push({ from: l.userId, to: w.userId, amount: base + (idx < rem ? 1 : 0) });
    });
  }

  const net = new Map<string, number>(preds.map((p) => [p.userId, 0]));
  for (const t of transfers) {
    net.set(t.from, net.get(t.from)! - t.amount);
    net.set(t.to, net.get(t.to)! + t.amount);
  }

  const results: PlayerResult[] = preds.map((p) => {
    const n = net.get(p.userId)!;
    return { userId: p.userId, result: n > 0 ? "win" : n < 0 ? "loss" : "push", net: n };
  });
  return { status: "settled", results, transfers };
}

// Splitwise-style greedy debt simplification for the league "settle up" view:
// net balances → ≤ N−1 directed payments (plan §17.8).
export function simplifyDebts(nets: Record<string, number>): Transfer[] {
  const creditors = Object.entries(nets).filter(([, n]) => n > 0).map(([id, n]) => ({ id, n }));
  const debtors = Object.entries(nets).filter(([, n]) => n < 0).map(([id, n]) => ({ id, n: -n }));
  // Magnitude desc, then id asc — the id tiebreak makes the plan identical no matter
  // what order `nets` is iterated (memberIds has no ORDER BY), so every viewer of a
  // league sees the same "who owes whom". Without it, ties produce divergent plans.
  creditors.sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
  debtors.sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
  const out: Transfer[] = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const pay = Math.min(creditors[ci].n, debtors[di].n);
    out.push({ from: debtors[di].id, to: creditors[ci].id, amount: pay });
    creditors[ci].n -= pay;
    debtors[di].n -= pay;
    if (creditors[ci].n === 0) ci++;
    if (debtors[di].n === 0) di++;
  }
  return out;
}
