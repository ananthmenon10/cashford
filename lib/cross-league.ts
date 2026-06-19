// Cross-league prediction duplication (plan 2026-06-19-001). Pure, deterministic helpers so the
// trickiest logic — sibling eligibility and the opt-in default-checked rule — is unit-testable.

export type PickShape = { outcome: "home" | "draw" | "away"; predHome: number; predAway: number };

export type OtherLeague = {
  contestId: string;
  leagueName: string;
  eligible: boolean;            // open + lock comfortably ahead → writable, offered as a checkbox
  existingPick: PickShape | null;
};

// Hide siblings within this window of lock at render time so a checkbox shown as eligible is
// realistically still writable by the time the user submits. RLS (+10s) remains the true gate.
export const RENDER_MARGIN_MS = 60_000;

// Eligible to mirror into = the sibling contest is open and its lock is comfortably ahead.
export function isEligible(status: string, lockAtMs: number, nowMs: number, marginMs: number): boolean {
  return status === "open" && lockAtMs > nowMs + marginMs;
}

export function samePick(a: PickShape | null | undefined, b: PickShape | null | undefined): boolean {
  if (!a || !b) return false;
  return a.outcome === b.outcome && a.predHome === b.predHome && a.predAway === b.predAway;
}

// Default-checked targets: eligible AND (no existing pick OR it already matches my pick here).
// A DIFFERENT existing pick starts UNCHECKED, so overwriting it is always an explicit opt-in.
export function defaultCheckedTargets(others: OtherLeague[], myPick: PickShape | null): string[] {
  return others
    .filter((l) => l.eligible && (!l.existingPick || samePick(l.existingPick, myPick)))
    .map((l) => l.contestId);
}
