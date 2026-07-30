import type { CardState } from "@/lib/contest-state";
import { voidPresentation, type VoidReason } from "@/lib/contest-copy";
import { C71, GW_BADGE_COPY } from "@/lib/gw-copy";

const BADGE: Record<string, { label: string; cls: string; pulse?: boolean }> = {
  open_nopick: { label: "OPEN", cls: "text-primary-press bg-mint" },
  open_picked: { label: "OPEN", cls: "text-primary-press bg-mint" },
  tbd: { label: "TBD", cls: "text-muted bg-subtle" },
  locked: { label: "LOCKED", cls: "text-label bg-subtle" },
  live: { label: "LIVE", cls: "text-white bg-live", pulse: true },
  settling: { label: "FT", cls: "text-label bg-subtle" },
  won: { label: "SETTLED", cls: "text-primary-press bg-mint" },
  lost: { label: "SETTLED", cls: "text-primary-press bg-mint" },
  push: { label: "SETTLED", cls: "text-primary-press bg-mint" },
  notentered: { label: "SETTLED", cls: "text-primary-press bg-mint" },
  void: { label: "VOID", cls: "text-push bg-subtle" },
  cancelled: { label: "CANCELLED", cls: "text-[#B91C1C] bg-[#FEE2E2] dark:text-[#fca5a5] dark:bg-[#ef44441f]" },
};

export type GwBadgeState =
  | "open"
  | "entered"
  | "locked"
  | "live"
  | "settled"
  | "void"
  | "action_needed"
  | "recalculating";

const GW_BADGE: Record<GwBadgeState, { label: string; cls: string; pulse?: boolean }> = {
  open: { label: GW_BADGE_COPY.open, cls: "text-cs2-green bg-cs2-green-soft" },
  entered: { label: GW_BADGE_COPY.entered, cls: "text-cs2-green bg-cs2-green-soft" },
  locked: { label: GW_BADGE_COPY.locked, cls: "text-cs2-ink-2 bg-cs2-line-2" },
  live: { label: GW_BADGE_COPY.live, cls: "text-white bg-live", pulse: true },
  settled: { label: GW_BADGE_COPY.settled, cls: "text-cs2-green bg-cs2-green-soft" },
  void: { label: GW_BADGE_COPY.void, cls: "text-cs2-ink-3 bg-cs2-line-2" },
  action_needed: { label: GW_BADGE_COPY.actionNeeded, cls: "text-cs2-amber bg-cs2-amber-soft" },
  recalculating: { label: C71, cls: "text-cs2-amber bg-cs2-amber-soft" },
};

type LegacyStatusBadgeProps = {
  kind?: "cup";
  state: CardState;
  voidReason?: VoidReason;
};

type GameweekStatusBadgeProps = {
  kind: "gameweek";
  state: GwBadgeState;
  voidReason?: never;
};

export function StatusBadge(props: LegacyStatusBadgeProps | GameweekStatusBadgeProps) {
  if (props.kind === "gameweek") {
    const normalized = props.state.toLowerCase().replaceAll(" ", "_") as GwBadgeState;
    const badge = GW_BADGE[normalized] ?? GW_BADGE.locked;
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${badge.cls}`}>
        {badge.pulse && <span className="h-1.5 w-1.5 rounded-full bg-white animate-live-pulse" />}
        {badge.label}
      </span>
    );
  }

  const { state, voidReason } = props;
  const b = BADGE[state] ?? BADGE.locked;
  // A "no_separation" void is a real result (all square), not a failure — distinct label + a
  // mint pill (like SETTLED) instead of the grey void pill.
  const label = state === "void" ? voidPresentation(voidReason).badge : b.label;
  const cls = state === "void" && voidReason === "no_separation" ? "text-primary-press bg-mint" : b.cls;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[10px] font-bold tracking-[.06em] ${cls}`}>
      {b.pulse && <span className="h-1.5 w-1.5 rounded-full bg-white animate-live-pulse" />}
      {label}
    </span>
  );
}

// Deterministic colour for an avatar / flag chip from a short code.
const PALETTE = ["#15A66A", "#6366f1", "#F2994A", "#0EA5E9", "#E11D48", "#7C3AED", "#334155", "#0E8455"];
export function chipColor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({ label, size = 28 }: { label: string; size?: number }) {
  const initials = label.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-mono font-bold text-white"
      style={{ width: size, height: size, background: chipColor(label), fontSize: size * 0.34 }}
    >
      {initials}
    </span>
  );
}

export function inr(n: number) {
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}₹${Math.abs(n).toLocaleString("en-IN")}`;
}
