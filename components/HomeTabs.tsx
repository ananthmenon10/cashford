"use client";

// Home dashboard tab shell (PRD: Leagues · Matches · Analytics). Leagues is the default and its
// content is unchanged from the previous home. Server renders all three panels as ReactNode; this
// client shell toggles visibility (full ARIA tabs, hydration-safe default). Matches carries a red
// attention dot when something is live or a pick is due.

import Link from "next/link";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { SlideTrack } from "./motion";

const TABS = ["Leagues", "Matches", "Analytics"] as const;

export function HomeTabs({
  leagues,
  matches,
  analytics,
  matchesAlert = false,
  bracketHref,
  bracketNew = false,
}: {
  leagues: ReactNode;
  matches: ReactNode;
  analytics: ReactNode;
  matchesAlert?: boolean;
  bracketHref?: string; // when set, renders a 4th "Bracket" nav link (routes away, not a tab panel)
  bracketNew?: boolean;
}) {
  const id = useId();
  const [active, setActive] = useState<0 | 1 | 2>(0);
  const panels = [leagues, matches, analytics];

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
      setActive(next as 0 | 1 | 2);
      document.getElementById(`${id}-t-${next}`)?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      document.getElementById(`${id}-t-0`)?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(2);
      document.getElementById(`${id}-t-2`)?.focus();
    }
  };

  return (
    <div>
      <div className="relative flex border-b border-border bg-surface">
        {/* display:contents keeps role=tablist wrapping ONLY the real tabs while the 4
            items still lay out as equal-width flex siblings of the bar. */}
        <div role="tablist" aria-label="Home" className="contents">
          {TABS.map((t, i) => (
            <button
              key={t}
              role="tab"
              id={`${id}-t-${i}`}
              aria-selected={active === i}
              aria-controls={`${id}-p-${i}`}
              tabIndex={active === i ? 0 : -1}
              onClick={() => setActive(i as 0 | 1 | 2)}
              onKeyDown={(e) => onKey(e, i)}
              className={`relative flex-1 py-3 text-center text-[13px] transition-colors ${
                active === i ? "font-extrabold text-fg" : "font-semibold text-muted"
              }`}
            >
              {t}
              {t === "Matches" && matchesAlert && (
                <span className="absolute right-[34px] top-2 h-1.5 w-1.5 rounded-full bg-live" />
              )}
            </button>
          ))}
        </div>
        {bracketHref && (
          <Link
            href={bracketHref}
            className="relative flex-1 py-3 text-center text-[13px] font-semibold text-muted transition-colors"
          >
            Bracket
            {bracketNew && (
              <span className="absolute right-[calc(50%-30px)] top-1.5 rounded-[5px] bg-live px-1 py-px text-[7.5px] font-extrabold tracking-[.04em] text-white">
                NEW
              </span>
            )}
          </Link>
        )}
        <SlideTrack count={bracketHref ? TABS.length + 1 : TABS.length} active={active} />
      </div>

      <div className="mx-auto max-w-[480px]">
        {panels.map((p, i) => (
          <div key={i} role="tabpanel" id={`${id}-p-${i}`} aria-labelledby={`${id}-t-${i}`} hidden={active !== i}>
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}
