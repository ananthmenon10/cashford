export type CompetitionFormat = "cup" | "league" | "gameweek";

export type LeagueParticipationRow = {
  competition_id: string;
  status: "active" | "archived";
  joined_at: string;
  eligible_from_gameweek_id?: string | null;
  competitions: {
    id: string;
    name: string;
    slug: string;
    format: CompetitionFormat;
    status: string;
  } | {
    id: string;
    name: string;
    slug: string;
    format: CompetitionFormat;
    status: string;
  }[];
};

export type ResolvedLeagueParticipation = {
  status: "active" | "archived" | "none";
  format: "cup" | "gameweek" | "none";
  competitionId?: string;
  competitionName?: string;
  competitionSlug?: string;
  eligibleFromGameweekId?: string | null;
};

function competitionFor(row: LeagueParticipationRow) {
  return Array.isArray(row.competitions) ? row.competitions[0] : row.competitions;
}

export function resolveLeagueParticipation(
  rows: readonly LeagueParticipationRow[],
): ResolvedLeagueParticipation {
  const ordered = [...rows].sort(
    (a, b) =>
      new Date(b.joined_at).getTime() -
      new Date(a.joined_at).getTime(),
  );
  const chosen =
    ordered.find((row) => row.status === "active") ??
    ordered.find((row) => row.status === "archived");
  if (!chosen) return { status: "none", format: "none" };
  const competition = competitionFor(chosen);
  const competitionId = chosen.competition_id;
  const rawFormat = competition?.format;
  if (!rawFormat || !competitionId) return { status: "none", format: "none" };
  return {
    status: chosen.status,
    competitionId,
    competitionName: competition?.name ?? competitionId,
    competitionSlug: competition?.slug ?? competitionId,
    format: rawFormat === "league" ? "gameweek" : rawFormat,
    eligibleFromGameweekId: chosen.eligible_from_gameweek_id ?? null,
  };
}
