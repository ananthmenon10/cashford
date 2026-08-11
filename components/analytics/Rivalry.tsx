"use client";

import { useEffect, useState } from "react";
import { ANALYTICS_COPY } from "@/lib/analytics-copy";
import type { AnalyticsRivalry, RivalryRecord } from "@/lib/analytics-rivalry";

function RecordLine({ record }: { record: RivalryRecord }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div>
        <div className="font-mono text-lg font-extrabold">{record.won}</div>
        <div className="text-[10px] font-semibold text-cs2-ink-3">{ANALYTICS_COPY.rivalryWon}</div>
      </div>
      <div>
        <div className="font-mono text-lg font-extrabold">{record.lost}</div>
        <div className="text-[10px] font-semibold text-cs2-ink-3">{ANALYTICS_COPY.rivalryLost}</div>
      </div>
      <div>
        <div className="font-mono text-lg font-extrabold">{record.tied}</div>
        <div className="text-[10px] font-semibold text-cs2-ink-3">{ANALYTICS_COPY.rivalryTied}</div>
      </div>
    </div>
  );
}

export function Rivalry({ module }: { module: AnalyticsRivalry | null }) {
  const [rivalId, setRivalId] = useState<string | null>(module?.defaultRivalId ?? null);

  useEffect(() => {
    if (module?.defaultRivalId && !module.byRivalId[rivalId ?? ""]) {
      setRivalId(module.defaultRivalId);
    }
  }, [module, rivalId]);

  if (!module || module.options.length === 0) return null;
  const selectedId = rivalId && module.byRivalId[rivalId] ? rivalId : module.defaultRivalId;
  const record = selectedId ? module.byRivalId[selectedId] : null;
  if (!record) return null;

  return (
    <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-extrabold">{ANALYTICS_COPY.rivalryTitle}</h3>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-cs2-ink-3">
          <span>{ANALYTICS_COPY.rivalrySelectLabel}</span>
          <select
            className="rounded-cs2-sm border border-cs2-line bg-cs2-paper px-2 py-1 text-[11px] dark:bg-white/[0.05]"
            value={selectedId ?? ""}
            onChange={(event) => setRivalId(event.target.value)}
          >
            {module.options.map((option) => (
              <option key={option.userId} value={option.userId}>{option.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3"><RecordLine record={record} /></div>
      <div className="mt-3 flex items-center justify-between text-[12px]">
        <span className="font-semibold">{ANALYTICS_COPY.rivalryExacts}</span>
        <span className="font-mono font-bold">{record.viewerExacts}–{record.rivalExacts}</span>
      </div>
      <p className="mt-2 text-[11px] text-cs2-ink-3">
        {ANALYTICS_COPY.rivalryFootnote(record.sharedGameweeks, record.settledGameweeks)}
      </p>
      {record.excludedGameweeks.length ? (
        <p className="mt-1 text-[11px] text-cs2-ink-3">
          {ANALYTICS_COPY.rivalryExcluded(record.excludedGameweeks.map((gw) => `GW${gw}`).join(", "))}
        </p>
      ) : null}
      {record.runOwner && record.currentRunLength > 0 ? (
        <p className="mt-1 text-[11px] text-cs2-ink-3">
          {ANALYTICS_COPY.rivalryRun(record.runOwner === "viewer" ? "you" : "rival", record.currentRunLength)}
        </p>
      ) : null}
    </section>
  );
}
