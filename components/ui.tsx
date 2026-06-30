import type { CardState } from "@/lib/contest-state";
import { voidPresentation, type VoidReason } from "@/lib/contest-copy";

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

export function StatusBadge({ state, voidReason }: { state: CardState; voidReason?: VoidReason }) {
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
