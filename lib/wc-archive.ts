import { accuracy, isCorrect, isExact, type Entry } from "./analytics";
import { C31, C32, C33 } from "./gw-copy";

export type WcArchiveMember = { userId: string; name: string; isViewer?: boolean; joinedAt?: string };
export type WcArchiveStanding = WcArchiveMember & {
  correct: number;
  exact: number;
  netInr: number | null;
  unavailable: boolean;
  finish: number;
};

export function buildWcFinalStandings(input: {
  members: readonly WcArchiveMember[];
  entriesByUser: ReadonlyMap<string, readonly Entry[]> | Record<string, readonly Entry[]>;
  netByUser: ReadonlyMap<string, number | null> | Record<string, number | null>;
  unavailableUserIds?: readonly string[];
}): WcArchiveStanding[] {
  const entriesFor = (userId: string) => input.entriesByUser instanceof Map
    ? [...(input.entriesByUser.get(userId) ?? [])]
    : [...((input.entriesByUser as Record<string, readonly Entry[]>)[userId] ?? [])];
  const netFor = (userId: string) => input.netByUser instanceof Map
    ? input.netByUser.get(userId) ?? null
    : (input.netByUser as Record<string, number | null>)[userId] ?? null;
  const unavailable = new Set(input.unavailableUserIds ?? []);
  const ordered = input.members.map((member) => {
    const entries = entriesFor(member.userId);
    const stats = accuracy(entries);
    return {
      ...member,
      correct: entries.filter(isCorrect).length,
      exact: entries.filter(isExact).length,
      netInr: netFor(member.userId),
      unavailable: unavailable.has(member.userId),
      finish: 0,
      _graded: stats.graded,
    };
  }).sort((a, b) =>
    (b.netInr ?? Number.NEGATIVE_INFINITY) - (a.netInr ?? Number.NEGATIVE_INFINITY) ||
    b.correct - a.correct || b.exact - a.exact || a.userId.localeCompare(b.userId),
  );
  return ordered.map((row, index) => {
    const { _graded: _unused, ...standing } = row;
    return { ...standing, finish: index + 1 };
  });
}

export function buildWcFinalTable(input: Parameters<typeof buildWcFinalStandings>[0]) {
  return buildWcFinalStandings(input);
}

export function combinedBalanceLabel(netInr: number): string {
  if (netInr > 0) return C32(netInr);
  if (netInr < 0) return C31(netInr);
  return C33;
}
