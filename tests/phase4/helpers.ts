import type { FixtureTiming } from "../../lib/insights-cadence";

export const upcoming = (
  minutesToKickoff: number,
  now = new Date("2026-02-03T10:00:00.000Z"),
): FixtureTiming => ({
  kickoffAt: new Date(now.getTime() + minutesToKickoff * 60_000),
  status: "scheduled",
  finishedAt: null,
});

export const live = (
  kickoffMinutesAgo: number,
  now = new Date("2026-02-03T10:00:00.000Z"),
): FixtureTiming => ({
  kickoffAt: new Date(now.getTime() - kickoffMinutesAgo * 60_000),
  status: "live",
  finishedAt: null,
});

export const finished = (
  minutesSinceFinish: number,
  now = new Date("2026-02-03T10:00:00.000Z"),
): FixtureTiming => ({
  kickoffAt: new Date(now.getTime() - 120 * 60_000),
  status: "finished",
  finishedAt: new Date(now.getTime() - minutesSinceFinish * 60_000),
});

export const pick = (
  fixtureId: string,
  predHome: number,
  predAway: number,
) => ({ fixtureId, predHome, predAway });

export const entry = (
  userId: string,
  picks: ReturnType<typeof pick>[],
) => ({ userId, picks });
