"use client";

import { useState, type ReactNode } from "react";

const TABS = ["Next 24h", "Later", "Live", "Done", "Dues"] as const;
type TabName = (typeof TABS)[number];

export function LeagueTabs({
  next24, later, live, done, dues, counts, next24Predicted, next24Predictable,
}: {
  next24: ReactNode; later: ReactNode; live: ReactNode; done: ReactNode; dues: ReactNode;
  counts: { "Next 24h": number; Later: number; Live: number; Done: number };
  next24Predicted: number;   // X — open matches already predicted
  next24Predictable: number; // Y — open (predictable) matches in next 24h
}) {
  // Default to the first time tab that has matches, so a quiet "Next 24h" (rest days
  // between rounds) doesn't open empty while "Later" has matches.
  const initial: TabName = counts["Next 24h"] > 0 ? "Next 24h" : counts.Later > 0 ? "Later" : "Next 24h";
  const [active, setActive] = useState<TabName>(initial);
  const panels: Record<TabName, ReactNode> = { "Next 24h": next24, Later: later, Live: live, Done: done, Dues: dues };

  return (
    <>
      <div className="sticky top-0 z-10 flex border-b border-border bg-bg">
        {TABS.map((t) => {
          const on = active === t;
          // Next 24h shows a colored predicted fraction; the rest show a muted count.
          const secondLine =
            t === "Next 24h"
              ? next24Predictable > 0
                ? <span className={`text-[11px] font-semibold ${next24Predicted === next24Predictable ? "text-win" : "text-loss"}`}>{next24Predicted}/{next24Predictable}</span>
                : null
              : t !== "Dues" && counts[t] > 0
                ? <span className="text-[11px] text-muted">{counts[t]}</span>
                : null;
          return (
            <button
              key={t}
              onClick={() => setActive(t)}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 -mb-px border-b-[2.5px] py-2 text-[13px] ${
                on ? "border-primary font-bold text-fg" : "border-transparent font-medium text-muted"
              }`}
            >
              <span>{t}</span>
              {secondLine}
            </button>
          );
        })}
      </div>
      <div className="pt-4">{panels[active]}</div>
    </>
  );
}
