export type FixtureTiming = {
  kickoffAt: Date | null;
  status?: string | null;
  finishedAt?: Date | null;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function ladderInterval(kickoffAt: Date, now: Date): number {
  const untilKickoff = kickoffAt.getTime() - now.getTime();
  if (untilKickoff <= 2 * HOUR) return 10 * MINUTE;
  if (untilKickoff <= 24 * HOUR) return HOUR;
  return 6 * HOUR;
}

export type ModelUsableRow = {
  model_ok?: boolean | null;
  model_fetched_at?: string | null;
  model_source_kickoff_at?: string | null;
};

export function modelUsable(
  row: ModelUsableRow | null,
  fixture: { kickoffAt: Date | null },
  now: Date,
): boolean {
  if (
    !row?.model_ok ||
    !row.model_fetched_at ||
    !row.model_source_kickoff_at ||
    !fixture.kickoffAt
  ) {
    return false;
  }
  if (
    new Date(row.model_source_kickoff_at).getTime() !==
    fixture.kickoffAt.getTime()
  ) {
    return false;
  }
  const age = now.getTime() - new Date(row.model_fetched_at).getTime();
  return age >= 0 && age <= 2 * ladderInterval(fixture.kickoffAt, now);
}
