import { NetValue } from "@/components/analytics/NetValue";
import { inr } from "@/components/ui";
import { ANALYTICS_COPY } from "@/lib/analytics-copy";
import type { MyFormTrend as MyFormTrendData } from "@/lib/analytics-feed";

type ExclusionReason = MyFormTrendData["excluded"][number]["reason"];

const EXCLUSION_ORDER: ExclusionReason[] = [
  "void",
  "not_entered",
  "recalculating",
  "no_counted_fixtures",
];

function exclusionCopy(reason: ExclusionReason, count: number) {
  switch (reason) {
    case "void":
      return ANALYTICS_COPY.trendExcludedVoid(count);
    case "not_entered":
      return ANALYTICS_COPY.trendExcludedNotEntered(count);
    case "recalculating":
      return ANALYTICS_COPY.trendExcludedDirty(count);
    case "no_counted_fixtures":
      return ANALYTICS_COPY.trendExcludedNoFixtures(count);
  }
}

export function MyFormTrend({ trend }: { trend: MyFormTrendData | null }) {
  if (!trend) return null;

  const values = trend.points.map((point) => point.ptsPerFixture);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const valueRange = max - min;
  const pad = valueRange * 0.1;
  const domainMin = min - pad;
  const domainRange = valueRange + pad * 2;
  const edgeInset = 4.5; // = last-point circle radius; keeps edge circles from clipping on the viewBox bounds
  const coordinates = trend.points.map((point, index) => {
    const x =
      trend.points.length === 1
        ? 150
        : edgeInset + (index / (trend.points.length - 1)) * (300 - edgeInset * 2);
    const y = valueRange === 0
      ? 41.5
      : 70 - ((point.ptsPerFixture - domainMin) / domainRange) * 57;
    return { ...point, x, y };
  });
  const polylinePoints = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const feet = values.map((value) => value.toFixed(2));
  const maxAbsNet = Math.max(...trend.bars.map((bar) => Math.abs(bar.net)), 0);
  const exclusionCounts = new Map<ExclusionReason, number>();
  for (const exclusion of trend.excluded) {
    exclusionCounts.set(exclusion.reason, (exclusionCounts.get(exclusion.reason) ?? 0) + 1);
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="rounded-cs2-md border border-cs2-line bg-cs2-paper p-3 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-wide text-cs2-ink-3">
          <span>{ANALYTICS_COPY.trendHead(trend.points.length)}</span>
          <span className="font-mono">{trend.rangeLabel}</span>
        </div>
        <svg
          className="mt-2 block h-[83px] w-full text-cs2-line"
          viewBox="0 0 300 83"
          preserveAspectRatio="none"
          role="img"
          aria-label={ANALYTICS_COPY.trendAria(
            trend.points[0].gwNumber,
            trend.points[trend.points.length - 1].gwNumber,
            feet[0],
            feet[feet.length - 1],
          )}
        >
          <line className="text-cs2-line" x1="0" x2="300" y1="21" y2="21" stroke="currentColor" strokeDasharray="4 4" />
          <line className="text-cs2-line" x1="0" x2="300" y1="50" y2="50" stroke="currentColor" strokeDasharray="4 4" />
          <polyline
            fill="none"
            points={polylinePoints}
            className="text-cs2-green"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {coordinates.map((point, index) => {
            const isLast = index === coordinates.length - 1;
            return (
              <circle
                key={point.gwNumber}
                cx={point.x}
                cy={point.y}
                r={isLast ? 4.5 : 3.5}
                fill={isLast ? "currentColor" : "white"}
                className="text-cs2-green"
                stroke="currentColor"
                strokeWidth="2"
              />
            );
          })}
        </svg>
        <div className="mt-1 flex justify-between gap-2 font-mono text-[10px] text-cs2-ink-3">
          {feet.map((foot, index) => (
            <span key={`${trend.points[index].gwNumber}-${foot}`} data-testid="trend-foot">
              {foot}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h4 className="text-[13px] font-extrabold">{ANALYTICS_COPY.netTrendTitle}</h4>
            <p className="mt-0.5 text-[11px] text-cs2-ink-3">
              {trend.startedAt == null
                ? ANALYTICS_COPY.netTrendSub(trend.bars.length)
                : ANALYTICS_COPY.netTrendSubStarted(trend.bars.length, inr(trend.startedAt))}
            </p>
          </div>
          <div className="font-mono text-[17px] font-extrabold">
            <NetValue net={trend.netDelta} />
          </div>
        </div>
        <div className="mt-2 flex h-9 items-end gap-1.5" aria-hidden="true">
          {trend.bars.map((bar) => {
            const height = bar.net === 0
              ? 2
              : Math.max(3, (Math.abs(bar.net) / maxAbsNet) * 36);
            const color = bar.net < 0 ? "bg-cs2-red" : bar.net > 0 ? "bg-cs2-green" : "bg-cs2-line";
            return (
              <span
                key={bar.gwNumber}
                data-testid="trend-bar"
                className={`min-w-0 flex-1 rounded-cs2-sm ${color}`}
                style={{ height: `${height}px` }}
              />
            );
          })}
        </div>
      </div>

      {EXCLUSION_ORDER.map((reason) => {
        const count = exclusionCounts.get(reason);
        if (!count) return null;
        return (
          <p key={reason} data-testid="trend-exclusion" className="text-[10px] text-cs2-ink-3">
            {exclusionCopy(reason, count)}
          </p>
        );
      })}
    </div>
  );
}
