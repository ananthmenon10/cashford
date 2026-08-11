"use client";

// Home dashboard tab shell. Leagues is the default. The server decides whether
// Analytics is useful yet; this client shell only renders the tabs it receives.

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { GW_UI_COPY } from "@/lib/gw-copy";
import { SlideTrack } from "./motion";
import { HomeTabsContext } from "./HomeTabsContext";

const TABS = ["Leagues", "Matches", "Analytics"] as const;

export function HomeTabs({
  leagues,
  matches,
  analytics,
  matchesAlert = false,
  analyticsVisible = false,
}: {
  leagues: ReactNode;
  matches: ReactNode;
  analytics?: ReactNode;
  matchesAlert?: boolean;
  analyticsVisible?: boolean;
}) {
  const id = useId();
  const [active, setActive] = useState(0);
  const tabs = analyticsVisible ? TABS : TABS.slice(0, 2);
  const panels = analyticsVisible ? [leagues, matches, analytics] : [leagues, matches];
  const tabCount = tabs.length;
  const [analyticsActivated, setAnalyticsActivated] = useState(false);

  useEffect(() => {
    if (analyticsVisible && active === 2) setAnalyticsActivated(true);
  }, [active, analyticsVisible]);

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (i + (e.key === "ArrowRight" ? 1 : tabCount - 1)) % tabCount;
      setActive(next);
      document.getElementById(`${id}-t-${next}`)?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      document.getElementById(`${id}-t-0`)?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(tabCount - 1);
      document.getElementById(`${id}-t-${tabCount - 1}`)?.focus();
    }
  };

  return (
    <div>
      <div className="relative flex border-b border-border bg-surface">
        <div role="tablist" aria-label={GW_UI_COPY.homeTabsAria} className="contents">
          {tabs.map((t, i) => (
            <button
              key={t}
              role="tab"
              id={`${id}-t-${i}`}
              aria-selected={active === i}
              aria-controls={`${id}-p-${i}`}
              tabIndex={active === i ? 0 : -1}
              onClick={() => setActive(i)}
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
        <SlideTrack count={tabCount} active={active} />
      </div>

      <HomeTabsContext.Provider value={{ activeIndex: active, analyticsActivated }}>
        <div className="mx-auto max-w-[480px]">
          {panels.map((p, i) => (
            <div key={i} role="tabpanel" id={`${id}-p-${i}`} aria-labelledby={`${id}-t-${i}`} hidden={active !== i}>
              {p}
            </div>
          ))}
        </div>
      </HomeTabsContext.Provider>
    </div>
  );
}
