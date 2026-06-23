"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

// Route-local tab switcher for the match screen. Server renders each panel as a ReactNode; this
// client shell just shows/hides them (state stays here, never lifted to the page). Full ARIA tabs
// pattern; default tab is 0 (no localStorage/window read in the initialiser → hydration-safe).
// Generalised (plan 2026-06-23-002) from a hardcoded 2-tab Predict/Insight switcher to arbitrary
// labels/panels, so the open-contest screen and the live/settled screen share one accessible shell.
// `firstTabCta` is an optional shortcut shown only on tab 0 that jumps to tab 1 (the Predict screen's
// "Form · H2H →" button) — concrete and used, not a speculative footer slot.
export function MatchTabs({
  labels, panels, firstTabCta,
}: {
  labels: string[];
  panels: ReactNode[];
  firstTabCta?: ReactNode;
}) {
  const id = useId();
  const [active, setActive] = useState(0);
  const n = labels.length;

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") { e.preventDefault(); setActive((i + 1) % n); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setActive((i - 1 + n) % n); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(n - 1); }
  };

  return (
    <div>
      <div role="tablist" aria-label="Match view" className="mb-3 flex gap-1 rounded-control bg-subtle p-1">
        {labels.map((t, i) => (
          <button
            key={t}
            role="tab"
            id={`${id}-t-${i}`}
            aria-selected={active === i}
            aria-controls={`${id}-p-${i}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
            className={`flex-1 rounded-[9px] py-2 text-[13px] ${
              active === i
                ? "bg-surface font-bold text-fg shadow-[0_1px_3px_rgba(15,23,42,.08)]"
                : "font-semibold text-muted"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {labels.map((t, i) => (
        <div key={t} role="tabpanel" id={`${id}-p-${i}`} aria-labelledby={`${id}-t-${i}`} hidden={active !== i}>
          {panels[i]}
        </div>
      ))}

      {firstTabCta && active === 0 && n > 1 && (
        <button
          type="button"
          onClick={() => setActive(1)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-control border border-border bg-surface py-3 text-[13px] font-bold text-label cf-press"
        >
          {firstTabCta}
        </button>
      )}
    </div>
  );
}
