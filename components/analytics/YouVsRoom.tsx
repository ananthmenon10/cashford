"use client";

import { ANALYTICS_COPY } from "@/lib/analytics-copy";
import type { AnalyticsYouVsRoom, RoomMetric } from "@/lib/analytics-room";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function decimal(value: number): string {
  return value.toFixed(2);
}

function renderedNumber(value: number, key: "rate" | "decimal"): string {
  return key === "rate" ? percent(value) : decimal(value);
}

function metricValue(metric: RoomMetric, key: "rate" | "decimal"): string | null {
  if (metric.viewer == null || metric.otherAverage == null || metric.difference == null) return null;
  const difference = metric.difference >= 0
    ? `+${renderedNumber(metric.difference, key)}`
    : renderedNumber(metric.difference, key);
  return `${renderedNumber(metric.viewer, key)} · ${renderedNumber(metric.otherAverage, key)} · ${difference}`;
}

const METRICS: {
  key: keyof AnalyticsYouVsRoom["metrics"];
  label: string;
  valueType: "rate" | "decimal";
}[] = [
  { key: "exactRate", label: ANALYTICS_COPY.exactRate, valueType: "rate" },
  { key: "resultRate", label: ANALYTICS_COPY.resultRate, valueType: "rate" },
  { key: "avgGoalMiss", label: ANALYTICS_COPY.avgGoalMiss, valueType: "decimal" },
  { key: "last5Form", label: ANALYTICS_COPY.last5Form, valueType: "decimal" },
];

export function YouVsRoom({ module }: { module: AnalyticsYouVsRoom | null }) {
  if (!module) return null;
  const rows = METRICS.map((item) => ({
    ...item,
    value: metricValue(module.metrics[item.key], item.valueType),
    otherAverage: module.metrics[item.key].otherAverage,
    otherCount: module.metrics[item.key].otherCount,
  })).filter((item) => item.value != null);
  if (rows.length === 0) return null;

  return (
    <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 dark:bg-white/[0.03]">
      <h3 className="text-[15px] font-extrabold">{ANALYTICS_COPY.youVsRoomTitle}</h3>
      <p className="mt-0.5 text-[11px] text-cs2-ink-3">
        {ANALYTICS_COPY.youVsRoomWindow(module.windowGameweeks.length, module.otherMemberCount)}
      </p>
      {module.excludedGameweeks?.length ? (
        <p className="mt-1 text-[11px] text-cs2-ink-3">
          {ANALYTICS_COPY.roomExcluded(module.excludedGameweeks.map((gw) => `GW${gw}`).join(", "))}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="font-semibold">
              <span className="block">{row.label}</span>
              {row.otherAverage != null && row.otherCount > 0 ? (
                <span className="block text-[10px] font-medium text-cs2-ink-3">
                  {ANALYTICS_COPY.roomAverage(row.otherCount)} {renderedNumber(row.otherAverage, row.valueType)}
                  {row.key === "avgGoalMiss" ? ` · ${ANALYTICS_COPY.lowerIsBetter}` : ""}
                </span>
              ) : null}
            </span>
            <span className="font-mono text-right font-bold">{row.value}</span>
          </div>
        ))}
      </div>
      {module.exactRateBars.length > 0 ? (
        <div className="mt-4 flex flex-col gap-1.5">
          {module.exactRateBars.map((bar) => (
            <div key={bar.userId} className="flex items-center gap-2 text-[11px]">
              <span className="w-20 truncate font-semibold">
                {bar.isViewer ? ANALYTICS_COPY.youLabel : bar.name ?? bar.userId}
              </span>
              <div className="h-1.5 flex-1 rounded-full bg-cs2-line">
                <div
                  className="h-1.5 rounded-full bg-cs2-green"
                  style={{ width: `${Math.max(0, Math.min(100, bar.rate * 100))}%` }}
                />
              </div>
              <span className="w-9 text-right font-mono">{percent(bar.rate)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {module.sentence ? (
        <p className="mt-3 text-[11px] text-cs2-ink-3">{module.sentence}</p>
      ) : null}
    </section>
  );
}
