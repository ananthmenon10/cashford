export type EligibilityBoundary = {
  eligibleFromGameweekNumber: number | null;
  leftAt?: string | null;
};

export function isEligibleForGameweek(
  targetGameweekNumber: number,
  league: EligibilityBoundary,
  member: EligibilityBoundary,
): boolean {
  if (!Number.isInteger(targetGameweekNumber)) return false;
  if (league.eligibleFromGameweekNumber == null || member.eligibleFromGameweekNumber == null) {
    return false;
  }
  return (
    league.eligibleFromGameweekNumber <= targetGameweekNumber &&
    member.eligibleFromGameweekNumber <= targetGameweekNumber &&
    member.leftAt == null
  );
}

export type EntryStatus = "entered" | "needs_update" | "locked_in" | "invalid";

export function resolveEntryCounts(
  entries: readonly { status: EntryStatus }[],
  eligibleMemberCount: number,
  options: { preDeadline: boolean; stakeInr: number },
) {
  const accepted = options.preDeadline
    ? new Set<EntryStatus>(["entered", "needs_update"])
    : new Set<EntryStatus>(["locked_in"]);
  const entered = entries.filter((entry) => accepted.has(entry.status)).length;
  return {
    numerator: entered,
    denominator: eligibleMemberCount,
    potInr: entered * options.stakeInr,
  };
}

export function entryPotNumbers(input: {
  entries: readonly { status: EntryStatus }[];
  eligibleMembers: number;
  stakeInr: number;
  deadlinePassed: boolean;
}) {
  const counts = resolveEntryCounts(input.entries, input.eligibleMembers, {
    preDeadline: !input.deadlinePassed,
    stakeInr: input.stakeInr,
  });
  return {
    entered: counts.numerator,
    eligible: counts.denominator,
    potInr: counts.potInr,
  };
}

export function isEligible(
  input: {
    leagueEligibleFromNumber: number | null;
    memberEligibleFromNumber: number | null;
    leftAt?: string | null;
  },
  targetGameweekNumber: number,
): boolean {
  return isEligibleForGameweek(
    targetGameweekNumber,
    { eligibleFromGameweekNumber: input.leagueEligibleFromNumber },
    {
      eligibleFromGameweekNumber: input.memberEligibleFromNumber,
      leftAt: input.leftAt,
    },
  );
}
