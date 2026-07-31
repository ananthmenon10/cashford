import { normalizeClubName } from "./fpl";

export interface ProviderFixture {
  kickoffAt: string | Date | null;
  homeName: string;
  awayName: string;
}

export interface ProviderCandidate {
  id: string;
  date: string;
  homeName: string;
  awayName: string;
}

function day(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function matchFixture(
  fixture: ProviderFixture,
  candidates: readonly ProviderCandidate[],
): {
  externalId: string;
  confidence: "exact" | "matched";
  matchedOn: { date: string; homeNorm: string; awayNorm: string };
} | null {
  if (!fixture.kickoffAt) return null;
  const date = day(fixture.kickoffAt);
  const homeNorm = normalizeClubName(fixture.homeName);
  const awayNorm = normalizeClubName(fixture.awayName);
  const matches = candidates.filter(
    (candidate) =>
      day(candidate.date) === date &&
      normalizeClubName(candidate.homeName) === homeNorm &&
      normalizeClubName(candidate.awayName) === awayNorm,
  );
  if (matches.length !== 1) return null;
  const candidate = matches[0];
  const exact =
    candidate.homeName === fixture.homeName &&
    candidate.awayName === fixture.awayName;
  return {
    externalId: candidate.id,
    confidence: exact ? "exact" : "matched",
    matchedOn: { date, homeNorm, awayNorm },
  };
}
