// Pure view-model over the settlement engine (plan 2026-06-23-002, Phase 1).
// UNIVERSAL: no I/O, no server-only imports — safe in BOTH server and client bundles
// (the "What if" simulator imports buildBoard into the client). Keep it import-clean.
//
// The MONEY lives in lib/settlement.ts (19 golden tests). This file only:
//   • runs settle() at a given score (live, hypothetical, or final),
//   • maps the result into a ranked board (you-first on ties),
//   • picks the explanatory prose by branch.
// It NEVER re-derives a net. settle()'s output is authoritative.

import { settle, type Outcome, type ResultKind, type Prediction } from "./settlement";

export interface PlayerPick {
  // `id` is opaque + stable: the server passes the auth userId (for its own render),
  // the CLIENT payload passes a non-PII token (e.g. "p3"). buildBoard only needs it
  // for keying and a deterministic tiebreak — never as PII.
  id: string;
  name: string;
  isMe: boolean;
  outcome: Outcome;
  predHome: number;
  predAway: number;
}

export interface BoardPlayer extends PlayerPick {
  net: number;
  result: ResultKind; // reuse the engine union — never a drifting copy
  pickLabel: string; // outcome short, e.g. "BRA" / "Draw" / "ARG" (RevealGrid shows the score separately)
}

export type BoardBranch = "split" | "closest-all" | "closest-none" | "void" | "undecided";
// NOT settlement's Settlement["status"] — "undecided" is a board-only state (settle() is never called).
export type BoardStatus = "settled" | "void" | "undecided";

export interface BoardVM {
  status: BoardStatus;
  rows: BoardPlayer[]; // net desc, isMe first on ties, then id asc
  you: BoardPlayer | null;
  winnerNames: string; // "you & Dev" / "—"
  branch: BoardBranch; // control-flow discriminant for styling — render logic branches on THIS, never `reason`
  reason: string;
  reasonIcon: string; // ✓ split · ◎ closest · · void/undecided  (DISPLAY ONLY)
  outcomeShort: string; // "BRA WIN" / "DRAW" / "ARG WIN" — describes the 90' scoreline the steppers show
  pot: number; // = Σ settle().transfers.amount (money moving); 0 when void/undecided
  ahead: number; // #(net > 0)
  behind: number; // #(net < 0)
}

export interface BuildBoardOpts {
  isKnockout: boolean;
  stake: number;
  homeShort: string;
  awayShort: string;
  // Settled knockouts decided by extra time / penalties pass the REAL stored advancer so the
  // board reproduces the stored result at a level 90' score (live/locked never pass it).
  advancerOverride?: "home" | "away";
}

const shortFor = (o: Outcome, homeShort: string, awayShort: string) =>
  o === "home" ? homeShort : o === "away" ? awayShort : "Draw";

// Outcome phrase for the prose, e.g. "a BRA win" / "an ARG win" / "a draw" / "BRA to advance".
function outcomePhrase(o: Outcome, isKnockout: boolean, homeShort: string, awayShort: string): string {
  if (isKnockout) return `${o === "home" ? homeShort : awayShort} to advance`;
  if (o === "draw") return "a draw";
  const team = o === "home" ? homeShort : awayShort;
  return `${/^[AEIOU]/i.test(team) ? "an" : "a"} ${team} win`;
}

function sortRows(rows: BoardPlayer[]): BoardPlayer[] {
  return [...rows].sort((x, y) => {
    if (y.net !== x.net) return y.net - x.net;
    if (x.isMe !== y.isMe) return x.isMe ? -1 : 1; // me-first on a net tie
    return x.id < y.id ? -1 : 1; // then deterministic by id
  });
}

// Score outcome (home/draw/away) for the chip + scoreline-based prose.
function scoreOutcome(home: number, away: number): Outcome {
  return home > away ? "home" : home < away ? "away" : "draw";
}

export function buildBoard(
  players: PlayerPick[],
  score: { home: number; away: number },
  opts: BuildBoardOpts,
): BoardVM {
  const { isKnockout, stake, homeShort, awayShort, advancerOverride } = opts;
  const { home, away } = score;
  const so = scoreOutcome(home, away);
  const outcomeShort = so === "home" ? `${homeShort} WIN` : so === "away" ? `${awayShort} WIN` : "DRAW";
  const mkLabel = (p: PlayerPick) => shortFor(p.outcome, homeShort, awayShort);

  // ── Knockout advancer guard (CRITICAL) ───────────────────────────────────────────────────────
  // settlement.ts:34 silently returns "away" when advancer is undefined. We MUST resolve a concrete
  // advancer before calling settle(); a level score with no override is genuinely undecided.
  let advancer: "home" | "away" | undefined;
  if (isKnockout) {
    const resolved = advancerOverride ?? (home > away ? "home" : home < away ? "away" : null);
    if (resolved == null) {
      const rows = sortRows(
        players.map((p) => ({ ...p, net: 0, result: "push" as ResultKind, pickLabel: mkLabel(p) })),
      );
      return {
        status: "undecided",
        rows,
        you: rows.find((r) => r.isMe) ?? null,
        winnerNames: "—",
        branch: "undecided",
        reason: "Too level to call — a knockout would go to extra time. No result yet.",
        reasonIcon: "·",
        outcomeShort,
        pot: 0,
        ahead: 0,
        behind: 0,
      };
    }
    advancer = resolved;
  }

  const preds: Prediction[] = players.map((p) => ({
    userId: p.id, outcome: p.outcome, predHome: p.predHome, predAway: p.predAway,
  }));
  const s = settle(preds, { isKnockout, ftHome: home, ftAway: away, advancer }, stake);

  const resultById = new Map(s.results.map((r) => [r.userId, r]));
  const rows = sortRows(
    players.map((p) => {
      const r = resultById.get(p.id);
      return { ...p, net: r?.net ?? 0, result: (r?.result ?? "push") as ResultKind, pickLabel: mkLabel(p) };
    }),
  );

  const you = rows.find((r) => r.isMe) ?? null;
  const winners = rows.filter((r) => r.net > 0);
  const winnerNames = winners.map((w) => (w.isMe ? "you" : w.name)).join(" & ") || "—";
  const pot = s.transfers.reduce((t, x) => t + x.amount, 0);
  const ahead = rows.filter((r) => r.net > 0).length;
  const behind = rows.filter((r) => r.net < 0).length;

  // ── Branch + prose (re-derived from the SAME inputs settle() saw — for copy only, not money) ──
  if (s.status === "void") {
    const reason = s.voidReason === "insufficient_entries"
      ? "Not enough players entered — stakes are returned."
      : "Too level to separate — no winner, everyone gets their stake back.";
    return { status: "void", rows, you, winnerNames: "—", branch: "void", reason, reasonIcon: "·", outcomeShort, pot, ahead, behind };
  }

  const ao: Outcome = isKnockout ? advancer! : so;
  const correct = players.filter((p) => p.outcome === ao).length;
  const phrase = outcomePhrase(ao, isKnockout, homeShort, awayShort);

  let branch: BoardBranch;
  let reason: string;
  let reasonIcon: string;
  if (correct > 0 && correct < players.length) {
    branch = "split";
    reasonIcon = "✓";
    reason = `${winners.length} ${winners.length === 1 ? "player called" : "of you called"} ${phrase}. The pot splits between them — the exact scoreline is ignored.`;
  } else if (correct === players.length) {
    branch = "closest-all";
    reasonIcon = "◎";
    reason = `Everyone called ${phrase}. It comes down to the closest scoreline — ${winnerNames} take it.`;
  } else {
    branch = "closest-none";
    reasonIcon = "◎";
    reason = `Nobody picked ${phrase}. The pool goes to whoever came closest — that's ${winnerNames}.`;
  }

  return { status: "settled", rows, you, winnerNames, branch, reason, reasonIcon, outcomeShort, pot, ahead, behind };
}
