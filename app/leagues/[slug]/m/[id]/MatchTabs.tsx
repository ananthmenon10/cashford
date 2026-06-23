"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

// Route-local 2-tab switcher for the open-contest predict screen (plan 2026-06-20-003).
// Server renders both panels as ReactNode; this client shell just shows/hides them (state stays
// here, never lifted to the page). Full ARIA tabs pattern; default tab is the literal "Predict"
// (no localStorage/window read in the initialiser → hydration-safe).
const TABS = ["Predict", "Full insight"] as const;

export function MatchTabs({ predict, insight }: { predict: ReactNode; insight: ReactNode }) {
  const id = useId();
  const [active, setActive] = useState<0 | 1>(0);
  const panels = [predict, insight];

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive(((i + 1) % 2) as 0 | 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(1);
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="Match view" className="mb-3 flex gap-1 rounded-control bg-subtle p-1">
        {TABS.map((t, i) => (
          <button
            key={t}
            role="tab"
            id={`${id}-t-${i}`}
            aria-selected={active === i}
            aria-controls={`${id}-p-${i}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i as 0 | 1)}
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

      {TABS.map((t, i) => (
        <div key={t} role="tabpanel" id={`${id}-p-${i}`} aria-labelledby={`${id}-t-${i}`} hidden={active !== i}>
          {panels[i]}
        </div>
      ))}

      {active === 0 && (
        <button
          type="button"
          onClick={() => setActive(1)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-control border border-border bg-surface py-3 text-[13px] font-bold text-label cf-press"
        >
          Form · H2H · group table <span className="text-primary">→</span>
        </button>
      )}
    </div>
  );
}
