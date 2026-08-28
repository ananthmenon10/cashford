export type FixtureOrderRow = {
  id: string;
  kickoffAt?: string | null;
  externalId?: number | string | null;
};

function kickoffTime(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareFixtureKickoff(
  left: FixtureOrderRow,
  right: FixtureOrderRow,
): number {
  const leftKickoff = kickoffTime(left.kickoffAt);
  const rightKickoff = kickoffTime(right.kickoffAt);
  if (leftKickoff < rightKickoff) return -1;
  if (leftKickoff > rightKickoff) return 1;

  const leftExternalId = left.externalId == null ? null : String(left.externalId);
  const rightExternalId = right.externalId == null ? null : String(right.externalId);
  if (leftExternalId != null && rightExternalId != null) {
    const externalDifference = compareStrings(leftExternalId, rightExternalId);
    if (externalDifference !== 0) return externalDifference;
  }
  return compareStrings(String(left.id), String(right.id));
}

export function sortFixturesByKickoff<T extends FixtureOrderRow>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(compareFixtureKickoff);
}
