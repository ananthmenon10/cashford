export interface FplAvailability {
  playerId: number;
  fplTeamId: number;
  name: string;
  status: "a" | "d" | "i" | "s" | "u" | "n";
  newsText: string;
  chanceOfPlaying: number | null;
}

export interface TeamNewsItem {
  player: string;
  reason: string;
  status: FplAvailability["status"];
}

export type TeamNews = {
  home: TeamNewsItem[];
  away: TeamNewsItem[];
};

const STATUS = new Set<FplAvailability["status"]>([
  "a",
  "d",
  "i",
  "s",
  "u",
  "n",
]);

export function parseAvailability(
  bootstrap: unknown,
): FplAvailability[] | null {
  if (
    !bootstrap ||
    typeof bootstrap !== "object" ||
    !Array.isArray((bootstrap as any).elements) ||
    !Array.isArray((bootstrap as any).teams)
  ) {
    return null;
  }
  const teamIds = new Set(
    (bootstrap as any).teams
      .map((team: any) => Number(team?.id))
      .filter((id: number) => Number.isInteger(id) && id > 0),
  );
  const rows: FplAvailability[] = [];
  for (const raw of (bootstrap as any).elements) {
    const playerId = Number(raw?.id);
    const fplTeamId = Number(raw?.team);
    const status = raw?.status;
    const playerName =
      typeof raw?.web_name === "string" ? raw.web_name.trim() : "";
    if (
      !Number.isInteger(playerId) ||
      playerId <= 0 ||
      !Number.isInteger(fplTeamId) ||
      !teamIds.has(fplTeamId) ||
      !STATUS.has(status) ||
      !playerName
    ) {
      return null;
    }
    const chance = raw.chance_of_playing_next_round;
    if (
      chance !== null &&
      (!Number.isInteger(chance) || chance < 0 || chance > 100)
    ) {
      return null;
    }
    rows.push({
      playerId,
      fplTeamId,
      name: playerName,
      status,
      newsText: typeof raw.news === "string" ? raw.news.trim() : "",
      chanceOfPlaying: chance,
    });
  }
  return rows;
}

export function teamNewsForFixture(
  rows: readonly FplAvailability[],
  homeFplTeamId: number,
  awayFplTeamId: number,
): TeamNews | null {
  const relevant = (teamId: number) =>
    rows
      .filter(
        (row) =>
          row.fplTeamId === teamId &&
          row.status !== "a" &&
          (row.newsText || row.chanceOfPlaying !== null),
      )
      .map((row) => ({
        player: row.name,
        reason:
          row.newsText ||
          (row.chanceOfPlaying === null
            ? "Availability uncertain"
            : `${row.chanceOfPlaying}% chance of playing`),
        status: row.status,
      }));
  const home = relevant(homeFplTeamId);
  const away = relevant(awayFplTeamId);
  return home.length || away.length ? { home, away } : null;
}
