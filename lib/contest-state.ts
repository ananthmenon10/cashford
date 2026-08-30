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

// Short live-status label. Halftime/breaks show a frozen label (not a ticking
// minute), since the minute is a server-polled value, not a client timer.
export function liveLabel(statusDetail?: string | null, minute?: number | null): string {
  switch (statusDetail) {
    case "STATUS_HALFTIME": return "HT";
    case "STATUS_END_OF_REGULATION":
    case "STATUS_END_OF_EXTRATIME": return "Break";
    case "STATUS_SHOOTOUT":
    case "STATUS_PENALTIES": return "Pens";
    case "STATUS_OVERTIME":
    case "STATUS_FIRST_EXTRA":
    case "STATUS_SECOND_EXTRA": return minute ? `ET ${minute}'` : "Extra time";
  }
  return minute ? `${minute}'` : "Live";
}

// Human label for the match-detail header. ESPN's status_detail is an enum
// name (STATUS_FULL_TIME); never show it raw.
export function matchStatusLabel(
  status: string,
  statusDetail?: string | null,
  minute?: number | null,
): string {
  if (status === "live") return `${liveLabel(statusDetail, minute)} · LIVE`;
  if (status === "finished") {
    if (statusDetail === "STATUS_FINAL_AET") return "Full time · AET";
    if (statusDetail === "STATUS_FINAL_PEN") return "Full time · Pens";
    return "Full time";
  }
  if (status === "scheduled") return "Kick-off to come";
  if (status === "postponed") return "Postponed";
  if (status === "cancelled") return "Cancelled";
  if (status === "abandoned") return "Abandoned";
  const raw = (statusDetail ?? status).replace(/^STATUS_/, "").replace(/_/g, " ").toLowerCase();
  return raw ? raw[0].toUpperCase() + raw.slice(1) : status;
}

export const ROUND_LABEL: Record<string, string> = {
  group: "Group", r32: "Round of 32", r16: "Round of 16",
  qf: "Quarter-final", sf: "Semi-final", third: "3rd place", final: "Final",
};
