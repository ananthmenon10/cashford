"use client";

import { ANALYTICS_COPY } from "@/lib/analytics-copy";
import type { AnalyticsHabits, HabitSplit } from "@/lib/analytics-habits";

function percent(value: number | null): string | null {
  return value == null ? null : `${Math.round(value * 100)}%`;
}

function SplitRow({ label, split }: { label: string; split: HabitSplit }) {
  const rate = percent(split.rate);
  if (rate == null) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="font-semibold">{label}</span>
      <span className="font-mono font-bold">{rate}</span>
    </div>
  );
}

export function PredictionHabits({ module }: { module: AnalyticsHabits | null }) {
  if (!module) return null;
  const drawRate = percent(module.drawRate);
  const actualDrawRate = percent(module.actualDrawRate);
  const homeBias = percent(module.homeBias);
  const actualHomeWinRate = percent(module.actualHomeWinRate);

  return (
    <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 dark:bg-white/[0.03]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-extrabold">{ANALYTICS_COPY.habitsTitle}</h3>
        <span className="font-mono text-[11px] text-cs2-ink-3">{ANALYTICS_COPY.habitsPicks(module.pickCount)}</span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {module.mostCalled ? (
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-semibold">{ANALYTICS_COPY.habitsMostCalled}</span>
            <span className="font-mono font-bold">
              {ANALYTICS_COPY.habitsMostCalledValue(
                module.mostCalled.predHome,
                module.mostCalled.predAway,
                module.mostCalled.count,
                module.pickCount,
              )}
            </span>
          </div>
        ) : null}
        {drawRate != null && actualDrawRate != null ? (
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-semibold">{ANALYTICS_COPY.habitsDrawRate}</span>
            <span className="font-mono font-bold">{drawRate} · {actualDrawRate}</span>
          </div>
        ) : null}
        {homeBias != null && actualHomeWinRate != null ? (
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-semibold">{ANALYTICS_COPY.habitsHomeBias}</span>
            <span className="font-mono font-bold">{homeBias} · {actualHomeWinRate}</span>
          </div>
        ) : null}
        {module.averageGoalsPredicted != null && module.averageGoalsScored != null ? (
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-semibold">{ANALYTICS_COPY.habitsGoals}</span>
            <span className="font-mono font-bold">
              {module.averageGoalsPredicted.toFixed(1)} · {module.averageGoalsScored.toFixed(1)}
            </span>
          </div>
        ) : null}
      </div>
      <div className="mt-4 border-t border-cs2-line pt-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-cs2-ink-3">{ANALYTICS_COPY.habitsConsensus}</div>
        <div className="flex flex-col gap-2">
          <SplitRow label={ANALYTICS_COPY.habitsWithCrowd} split={module.consensus.withCrowd} />
          <SplitRow label={ANALYTICS_COPY.habitsAgainstCrowd} split={module.consensus.against} />
          <SplitRow label={ANALYTICS_COPY.habitsNoConsensus} split={module.consensus.noConsensus} />
        </div>
      </div>
      {module.sentence ? (
        <p className="mt-3 text-[11px] text-cs2-ink-3">
          {ANALYTICS_COPY.habitsAgainstSentence(module.sentence.againstCorrect, module.sentence.againstCount)}
        </p>
      ) : null}
      {module.excludedGameweeks?.length ? (
        <p className="mt-1 text-[11px] text-cs2-ink-3">
          {ANALYTICS_COPY.habitsExcluded(module.excludedGameweeks.map((item) => `GW${item.gwNumber} (${item.reason})`).join(", "))}
        </p>
      ) : null}
    </section>
  );
}
