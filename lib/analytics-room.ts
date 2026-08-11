import type { SeasonMemberGameweek } from "./gw-season";
import { ANALYTICS_COPY } from "./analytics-copy";

export type RoomMetric = {
  viewer: number | null;
  otherAverage: number | null;
  difference: number | null;
  otherCount: number;
};

export type RoomBar = {
  userId: string;
  rate: number;
  /** Added by the route after the pure builder resolves the viewer and display names. */
  isViewer?: boolean;
  name?: string;
};

export type AnalyticsYouVsRoom = {
  windowGameweeks: number[];
  excludedGameweeks?: number[];
  otherMemberCount: number;
  metrics: {
    exactRate: RoomMetric;
    resultRate: RoomMetric;
    avgGoalMiss: RoomMetric;
    last5Form: RoomMetric;
  };
  exactRateBars: RoomBar[];
  sentence: string | null;
};

type MetricKey = "exacts" | "correctPicks" | "goalError" | "points";

function rowsFor(
  rows: readonly SeasonMemberGameweek[],
  userId: string,
  window: ReadonlySet<number>,
): SeasonMemberGameweek[] {
  return rows.filter(
    (row) =>
      row.userId === userId &&
      row.entered &&
      row.settled &&
      window.has(row.gwNumber),
  );
}

function hasDataInWindow(rows: readonly SeasonMemberGameweek[], window: ReadonlySet<number>): boolean {
  return rows.some(
    (row) => window.has(row.gwNumber) && row.entered && row.settled &&
      typeof row.countedFixtures === "number" && row.countedFixtures > 0,
  );
}

function rate(
  rows: readonly SeasonMemberGameweek[],
  key: MetricKey,
  window: ReadonlySet<number>,
): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const row of rows) {
    if (!window.has(row.gwNumber) || !row.entered || !row.settled) continue;
    const value = row[key];
    const fixtures = row.countedFixtures;
    if (typeof value !== "number" || typeof fixtures !== "number" || fixtures <= 0) continue;
    numerator += value;
    denominator += fixtures;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function comparison(
  rows: readonly SeasonMemberGameweek[],
  viewerId: string,
  key: MetricKey,
  window: ReadonlySet<number>,
): RoomMetric {
  const viewer = rate(rowsFor(rows, viewerId, window), key, window);
  const otherRates = [...new Set(rows.map((row) => row.userId))]
    .filter((userId) => userId !== viewerId)
    .map((userId) => rate(rowsFor(rows, userId, window), key, window))
    .filter((value): value is number => value != null);
  const otherAverage = otherRates.length
    ? otherRates.reduce((sum, value) => sum + value, 0) / otherRates.length
    : null;
  return {
    viewer,
    otherAverage,
    difference: viewer != null && otherAverage != null ? viewer - otherAverage : null,
    otherCount: otherRates.length,
  };
}

export function buildYouVsRoom(
  memberGameweeks: readonly SeasonMemberGameweek[],
  viewerId: string,
): AnalyticsYouVsRoom | null {
  const windowGameweeks = [...new Set(
    memberGameweeks
      .filter((row) => row.userId === viewerId && row.entered && row.settled)
      .map((row) => row.gwNumber),
  )].sort((a, b) => a - b);
  if (windowGameweeks.length === 0) return null;
  const window = new Set(windowGameweeks);
  const excludedGameweeks = [...new Set(
    memberGameweeks
      .filter((row) => row.userId === viewerId && row.entered && !row.settled)
      .map((row) => row.gwNumber),
  )].sort((a, b) => a - b);
  const otherMemberIds = [...new Set(memberGameweeks.map((row) => row.userId))]
    .filter((userId) => userId !== viewerId)
    .filter((userId) => hasDataInWindow(memberGameweeks.filter((row) => row.userId === userId), window));
  if (otherMemberIds.length < 2) return null;

  const metrics = {
    exactRate: comparison(memberGameweeks, viewerId, "exacts", window),
    resultRate: comparison(memberGameweeks, viewerId, "correctPicks", window),
    avgGoalMiss: comparison(memberGameweeks, viewerId, "goalError", window),
    last5Form: comparison(
      memberGameweeks,
      viewerId,
      "points",
      new Set(windowGameweeks.slice(-5)),
    ),
  };
  if (!Object.values(metrics).some((metric) => metric.viewer != null && metric.otherAverage != null)) {
    return null;
  }
  const sentenceCandidate = (
    [
      { label: ANALYTICS_COPY.exactRate, difference: metrics.exactRate.difference, higherIsBetter: true },
      { label: ANALYTICS_COPY.resultRate, difference: metrics.resultRate.difference, higherIsBetter: true },
      { label: ANALYTICS_COPY.avgGoalMiss, difference: metrics.avgGoalMiss.difference, higherIsBetter: false },
      { label: ANALYTICS_COPY.last5Form, difference: metrics.last5Form.difference, higherIsBetter: true },
    ] as { label: string; difference: number | null; higherIsBetter: boolean }[]
  )
    .filter((candidate): candidate is { label: string; difference: number; higherIsBetter: boolean } => candidate.difference != null)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.label.localeCompare(b.label))[0];
  const exactRateBars = [...new Set(memberGameweeks.map((row) => row.userId))]
    .map((userId) => ({
      userId,
      rate: rate(rowsFor(memberGameweeks, userId, window), "exacts", window),
    }))
    .filter((bar): bar is { userId: string; rate: number } => bar.rate != null)
    .sort(
      (a, b) =>
        (a.userId === viewerId ? -1 : 0) - (b.userId === viewerId ? -1 : 0) ||
        b.rate - a.rate ||
        a.userId.localeCompare(b.userId),
    );

  return {
    windowGameweeks,
    excludedGameweeks,
    otherMemberCount: otherMemberIds.length,
    metrics,
    exactRateBars,
    sentence: sentenceCandidate
      ? ANALYTICS_COPY.roomSentence(
          sentenceCandidate.label,
          (sentenceCandidate.higherIsBetter
            ? sentenceCandidate.difference
            : -sentenceCandidate.difference) >= 0
            ? "ahead"
            : "behind",
        )
      : null,
  };
}
