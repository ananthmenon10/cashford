import {
  ladderInterval,
  type FixtureTiming,
} from "./insights-cadence";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function age(lastFetchedAt: Date | null, now: Date): number {
  return lastFetchedAt ? now.getTime() - lastFetchedAt.getTime() : Infinity;
}

function until(fx: FixtureTiming, now: Date): number | null {
  return fx.kickoffAt
    ? fx.kickoffAt.getTime() - now.getTime()
    : null;
}

export function oddsDueAt(
  fx: FixtureTiming,
  lastFetchedAt: Date | null,
  now: Date,
): boolean {
  const remaining = until(fx, now);
  return (
    remaining != null &&
    remaining > 0 &&
    age(lastFetchedAt, now) >= ladderInterval(fx.kickoffAt!, now)
  );
}

export function contextDueAt(
  fx: FixtureTiming,
  lastFetchedAt: Date | null,
  now: Date,
): boolean {
  const remaining = until(fx, now);
  return remaining != null && remaining > 0 && age(lastFetchedAt, now) >= HOUR;
}

export function lineupsDueAt(
  fx: FixtureTiming,
  lastFetchedAt: Date | null,
  now: Date,
): boolean {
  const remaining = until(fx, now);
  if (remaining == null || remaining > 90 * MINUTE || remaining <= 0) return false;
  return age(lastFetchedAt, now) >= 5 * MINUTE;
}

export function eventsDueAt(
  fx: FixtureTiming,
  lastFetchedAt: Date | null,
  now: Date,
): boolean {
  const remaining = until(fx, now);
  if (remaining == null || remaining > 5 * MINUTE) return false;
  if (fx.status === "finished") {
    if (!fx.finishedAt) return false;
    const sinceFinish = now.getTime() - fx.finishedAt.getTime();
    if (sinceFinish < 5 * MINUTE) return false;
    const passAt =
      sinceFinish >= 30 * MINUTE
        ? fx.finishedAt.getTime() + 30 * MINUTE
        : fx.finishedAt.getTime() + 5 * MINUTE;
    return lastFetchedAt == null || lastFetchedAt.getTime() < passAt;
  }
  return fx.status === "live" && age(lastFetchedAt, now) >= MINUTE;
}

export function statsDueAt(
  fx: FixtureTiming,
  lastFetchedAt: Date | null,
  now: Date,
): boolean {
  if (fx.status === "live") return age(lastFetchedAt, now) >= 2 * MINUTE;
  return eventsDueAt(fx, lastFetchedAt, now);
}

export function commentaryDueAt(
  fx: FixtureTiming,
  lastFetchedAt: Date | null,
  now: Date,
): boolean {
  if (fx.status !== "finished" || !fx.finishedAt) return false;
  return (
    now.getTime() - fx.finishedAt.getTime() >= 10 * MINUTE &&
    lastFetchedAt == null
  );
}

export function teamNewsDueAt(
  fx: FixtureTiming,
  lastFetchedAt: Date | null,
  now: Date,
): boolean {
  const remaining = until(fx, now);
  if (remaining == null || remaining <= 0 || remaining > 48 * HOUR) return false;
  const cadence = remaining <= 3 * HOUR ? 10 * MINUTE : 30 * MINUTE;
  return age(lastFetchedAt, now) >= cadence;
}
