"use client";

import { GW_UI_COPY } from "@/lib/gw-copy";

export function clampScore(value: number): number {
  return Math.max(0, Math.min(9, Math.round(value)));
}

export function ScoreStepper({
  side,
  value,
  onChange,
  disabled,
}: {
  side: "home" | "away";
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const current = value ?? 0;
  const decrease =
    side === "home" ? GW_UI_COPY.decreaseHome : GW_UI_COPY.decreaseAway;
  const increase =
    side === "home" ? GW_UI_COPY.increaseHome : GW_UI_COPY.increaseAway;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={decrease}
        disabled={disabled || (value != null && current <= 0)}
        onClick={() => onChange(value == null ? 0 : clampScore(current - 1))}
        className="grid h-9 w-9 place-items-center rounded-cs2-sm border border-cs2-line bg-cs2-paper text-lg font-bold text-cs2-ink-2 disabled:opacity-35"
      >
        −
      </button>
      <span className="min-w-7 text-center font-mono text-xl font-extrabold tabular">
        {value ?? "·"}
      </span>
      <button
        type="button"
        aria-label={increase}
        disabled={disabled || (value != null && current >= 9)}
        onClick={() => onChange(value == null ? 0 : clampScore(current + 1))}
        className="grid h-9 w-9 place-items-center rounded-cs2-sm border border-cs2-line bg-cs2-paper text-lg font-bold text-cs2-ink-2 disabled:opacity-35"
      >
        +
      </button>
    </div>
  );
}
