"use client";

import { ANALYTICS_COPY } from "@/lib/analytics-copy";
import type { AnalyticsWeeklyLabels, WeeklyLabel } from "@/lib/analytics-labels";

function awardedReason(label: WeeklyLabel, countedFixtures: number): string {
  const awarded = label.awarded!;
  switch (label.key) {
    case "oracle":
      return ANALYTICS_COPY.oracleReason(awarded.value, awarded.runnerUp);
    case "nearly":
      return ANALYTICS_COPY.nearlyReason(awarded.value);
    case "crowd":
      return ANALYTICS_COPY.crowdReason(awarded.value, countedFixtures);
    case "maverick":
      return ANALYTICS_COPY.maverickReason(awarded.value);
  }
}

function AwardCard({ label, countedFixtures }: { label: WeeklyLabel; countedFixtures: number }) {
  const awarded = label.awarded!;
  const viewerAward = awarded.isViewer;
  return (
    <div
      data-testid="weekly-label"
      className={`rounded-cs2-md border p-3 ${
        viewerAward
          ? "border-cs2-green-line bg-cs2-green-soft"
          : "border-cs2-line bg-cs2-canvas"
      }`}
    >
      <div data-testid="weekly-label-awarded" className="contents">
        <span className="text-[19px] leading-none">{label.emoji}</span>
        <div className="mt-2">
          <div className={`text-[10px] font-bold uppercase tracking-wide ${viewerAward ? "text-cs2-green" : "text-cs2-ink-3"}`}>
            {label.name}
          </div>
          <div className="mt-1 text-[15px] font-extrabold">
            {viewerAward ? ANALYTICS_COPY.weeklyLabelYou : awarded.name}
          </div>
          <div className="mt-1 text-[11px] font-semibold leading-[1.4] text-cs2-ink-3">
            {awardedReason(label, countedFixtures)}
          </div>
        </div>
      </div>
    </div>
  );
}

function OffCard({ label }: { label: WeeklyLabel }) {
  return (
    <div
      data-testid="weekly-label"
      className="rounded-cs2-md border border-cs2-line border-dashed bg-cs2-canvas p-3"
    >
      <div data-testid="weekly-label-off" className="contents">
        <span className="text-[19px] leading-none opacity-40 grayscale">{label.emoji}</span>
        <div className="mt-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-cs2-ink-3">{label.name}</div>
          <div className="mt-1 text-[12.5px] font-bold text-cs2-ink-3">
            {ANALYTICS_COPY.weeklyLabelNotAwarded}
          </div>
          <div className="mt-1 text-[11px] font-semibold leading-[1.4] text-cs2-ink-3">
            {label.notAwardedReason}
          </div>
        </div>
      </div>
    </div>
  );
}

export function WeeklyLabels({ module }: { module: AnalyticsWeeklyLabels | null }) {
  if (!module) return null;

  return (
    <section className="rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 dark:bg-white/[0.03]">
      <h3 className="text-[15px] font-extrabold">{ANALYTICS_COPY.weeklyLabelsTitle}</h3>
      <p className="mt-0.5 text-[11px] text-cs2-ink-3">
        {ANALYTICS_COPY.weeklyLabelsSub(module.gwNumber, module.entrantCount, module.countedFixtures)}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {module.labels.map((label) =>
          label.awarded ? (
            <AwardCard key={label.key} label={label} countedFixtures={module.countedFixtures} />
          ) : (
            <OffCard key={label.key} label={label} />
          ),
        )}
      </div>
      <p className="mt-3 text-[11px] text-cs2-ink-3">
        {ANALYTICS_COPY.weeklyLabelsFootnote(module.gwNumber, module.entrantCount)}
      </p>
    </section>
  );
}
