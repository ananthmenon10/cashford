import { accuracy, isCorrect, isExact, type Entry } from "./analytics";
import { C31Prefix, C32Prefix, C33 } from "./gw-copy";

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

/** Counts distinct settled fixtures from contest_results rows. Deliberately keyed on
 * fixture_id (not contests.id) — the contest_results select never fetches contests.id, so
 * counting on it silently collapses every row to the same undefined key. */
export function countSettledFixtures(fixtureIds: readonly (string | null | undefined)[]): number {
  const ids = new Set<string>();
  for (const id of fixtureIds) {
    if (id) ids.add(id);
  }
  return ids.size;
}

/** Balance for the archive owed-line, split so the amount can render bold in mono without
 * parsing it back out of the assembled sentence. amount is null when settled up. Prefixes are
 * derived from the canonical C31/C32 strings so a copy change can't silently diverge. sign
 * drives the app-wide green-positive/red-negative/ink-zero coloring convention. */
export function combinedBalanceParts(
  netInr: number,
): { prefix: string; amount: string | null; sign: "positive" | "negative" | "zero" } {
  if (netInr > 0) {
    return { prefix: C32Prefix, amount: `₹${Math.abs(netInr).toLocaleString("en-IN")}`, sign: "positive" };
  }
  if (netInr < 0) {
    return { prefix: C31Prefix, amount: `₹${Math.abs(netInr).toLocaleString("en-IN")}`, sign: "negative" };
  }
  return { prefix: C33, amount: null, sign: "zero" };
}

/** App-wide money convention: U+2212 minus (not ASCII hyphen) before ₹ for negative amounts. */
export function wcNetLabel(netInr: number | null): string {
  if (netInr == null) return "—";
  if (netInr < 0) return `−₹${Math.abs(netInr).toLocaleString("en-IN")}`;
  return `₹${netInr.toLocaleString("en-IN")}`;
}

/** "Net ₹8,914" / "Net −₹8,914" / "Net —" — the recap card's labeled net line. */
export function wcNetLine(netInr: number | null): string {
  return `Net ${wcNetLabel(netInr)}`;
}
