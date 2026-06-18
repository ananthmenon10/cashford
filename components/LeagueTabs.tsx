"use client";

import { useState, type ReactNode } from "react";

const TABS = ["Upcoming", "Live", "Done", "Dues"] as const;
type TabName = (typeof TABS)[number];

export function LeagueTabs({
  upcoming, live, done, dues, counts,
}: {
  upcoming: ReactNode; live: ReactNode; done: ReactNode; dues: ReactNode;
  counts: { Upcoming: number; Live: number; Done: number };
}) {
  const [active, setActive] = useState<TabName>("Upcoming");
  const panels: Record<TabName, ReactNode> = { Upcoming: upcoming, Live: live, Done: done, Dues: dues };

  return (
    <>
      <div className="sticky top-0 z-10 flex gap-5 border-b border-border bg-bg">
        {TABS.map((t) => {
          const n = t !== "Dues" ? counts[t] : undefined;
          const on = active === t;
          return (
            <button
              key={t}
              onClick={() => setActive(t)}
              className={`-mb-px border-b-[2.5px] pb-2.5 text-[13px] ${
                on ? "border-primary font-bold text-fg" : "border-transparent font-medium text-muted"
              }`}
            >
              {t}{n != null && n > 0 ? <span className="ml-1 text-muted">{n}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="pt-4">{panels[active]}</div>
    </>
  );
}
