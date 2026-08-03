export type InviteParticipation =
  | {
      participation: "active";
      competitionId: string;
      competitionSlug: string;
      competitionName: string;
      competitionFormat: "gameweek" | "cup";
    }
  | {
      participation: "archived";
      competitionId: string;
      competitionSlug: string;
      competitionName: string;
      competitionFormat: "gameweek" | "cup";
    }
  | { participation: "none" };

export type InviteDTO =
  | { status: "notfound" }
  | { status: "revoked" }
  | ({
      status: "active";
      leagueId: string;
      slug: string;
      leagueName: string;
      captainName: string;
      memberCount: number;
      stakeInr: number;
      token: string;
      leagueStatus: string;
      competitionSlug: string | null;
      anteInr: number;
      nextGameweekNumber: number | null;
      nextDeadlineAt: string | null;
      eligibleFromGameweekNumber: number | null;
    } & InviteParticipation);

export type InviteSource =
  | { status: "notfound" }
  | { status: "revoked" }
  | {
      status: "active";
      leagueId: string;
      slug: string;
      leagueName: string;
      captainName: string;
      memberCount: number;
      stakeInr: number;
      token: string;
      leagueStatus: string;
      competitionSlug?: string | null;
      anteInr?: number;
      nextGameweekNumber?: number | null;
      nextDeadlineAt?: string | null;
      eligibleFromGameweekNumber?: number | null;
      competitions?: {
        status: "active" | "archived";
        id: string;
        slug: string;
        name: string;
        format: "league" | "gameweek" | "cup";
        updatedAt?: string;
        joinedAt?: string;
      }[];
    };

export function activeCompetitions<T extends { status: string }>(
  competitions: readonly T[],
): T[] {
  return competitions.filter((competition) => competition.status === "active");
}

export function resolveInvite(source: InviteSource): InviteDTO {
  if (source.status !== "active") return source;
  const rows = [...(source.competitions ?? [])].sort(
    (a, b) =>
      new Date(b.joinedAt ?? b.updatedAt ?? 0).getTime() -
      new Date(a.joinedAt ?? a.updatedAt ?? 0).getTime(),
  );
  const participation =
    activeCompetitions(rows)[0] ??
    rows.find((row) => row.status === "archived");
  const base = {
    status: source.status,
    leagueId: source.leagueId,
    slug: source.slug,
    leagueName: source.leagueName,
    captainName: source.captainName,
    memberCount: source.memberCount,
    stakeInr: source.stakeInr,
    token: source.token,
    leagueStatus: source.leagueStatus,
    competitionSlug: null,
    anteInr: source.stakeInr,
    nextGameweekNumber: null,
    nextDeadlineAt: null,
    eligibleFromGameweekNumber: null,
  } as const;
  if (!participation) return { ...base, participation: "none" };
  return {
    ...base,
    participation: participation.status,
    competitionId: participation.id,
    competitionSlug: participation.slug ?? null,
    competitionName: participation.name,
    competitionFormat:
      participation.format === "league" ? "gameweek" : participation.format,
    anteInr: source.anteInr ?? source.stakeInr,
    nextGameweekNumber: source.nextGameweekNumber ?? null,
    nextDeadlineAt: source.nextDeadlineAt ?? null,
    eligibleFromGameweekNumber: source.eligibleFromGameweekNumber ?? null,
  };
}
