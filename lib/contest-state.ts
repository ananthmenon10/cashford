// Pure MatchCard state derivation (plan §11.3 + §17.9). No I/O — unit-testable.

export type ContestStatus = "open" | "locked" | "settling" | "void" | "cancelled" | "settled";
export type FixtureStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "abandoned";
export type ResultKind = "win" | "loss" | "push" | "not_entered" | "void";

export type CardState =
  | "open_nopick"   // S1
  | "open_picked"   // S2
  | "tbd"           // S3
  | "locked"        // S4
  | "live"          // S5
  | "settling"      // S5b
  | "won"           // S6
  | "lost"          // S7
  | "push"          // S8
  | "notentered"    // S9
  | "void"          // S10
  | "cancelled";    // S11
// (S12 "advanced" is an overlay on settled knockout cards, not a separate state.)

export interface CardInput {
  contestStatus: ContestStatus;
  fixtureStatus: FixtureStatus;
  lockAtMs: number;
  nowMs: number;
  isKnockout: boolean;
  homeKnown: boolean;
  awayKnown: boolean;
  hasMyPrediction: boolean;
  myResult?: ResultKind | null;
}

export function deriveCardState(i: CardInput): CardState {
  if (i.contestStatus === "cancelled") return "cancelled";
  if (i.contestStatus === "void") return "void";
  if (i.contestStatus === "settled") {
    switch (i.myResult) {
      case "win": return "won";
      case "loss": return "lost";
      case "not_entered": return "notentered";
      default: return "push";
    }
  }
  // Not yet settled:
  if (i.fixtureStatus === "finished") return "settling"; // S5b — settle cron pending
  if (i.fixtureStatus === "live") return "live";
  // Locked: either cron flipped it, or lock_at has passed but cron lags (§17.9)
  if (i.contestStatus === "locked" || i.lockAtMs <= i.nowMs) return "locked";
  // Open and still before lock:
  if (i.isKnockout && (!i.homeKnown || !i.awayKnown)) return "tbd";
  return i.hasMyPrediction ? "open_picked" : "open_nopick";
}

export type Tab = "upcoming" | "live" | "done";
export function tabForState(s: CardState): Tab {
  if (s === "won" || s === "lost" || s === "push" || s === "notentered" || s === "void" || s === "cancelled")
    return "done";
  if (s === "live" || s === "settling") return "live";
  return "upcoming"; // open_nopick, open_picked, tbd, locked
}

export const ROUND_LABEL: Record<string, string> = {
  group: "Group", r32: "Round of 32", r16: "Round of 16",
  qf: "Quarter-final", sf: "Semi-final", third: "3rd place", final: "Final",
};
