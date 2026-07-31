export const ESPN_STANDINGS_URL =
  "https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings";

export interface CompetitionStanding {
  rank: number;
  club: string;
  club_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gd: number;
  points: number;
  form: Array<"W" | "D" | "L">;
}

const num = (value: unknown): number | null => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseEspnStandings(raw: unknown): CompetitionStanding[] | null {
  if (!raw || typeof raw !== "object") return null;
  const groups = Array.isArray((raw as any).children)
    ? (raw as any).children
    : Array.isArray((raw as any).standings?.groups)
      ? (raw as any).standings.groups
      : [];
  const entries = groups.flatMap((group: any) =>
    Array.isArray(group?.standings?.entries) ? group.standings.entries : [],
  );
  const stat = (entry: any, names: string[]) => {
    const row = (entry?.stats ?? []).find((item: any) =>
      names.includes(String(item?.name ?? item?.type).toLowerCase()),
    );
    return num(row?.value ?? row?.displayValue);
  };
  const rows: CompetitionStanding[] = entries.flatMap((entry: any) => {
    const club = entry?.team?.displayName;
    const clubId = entry?.team?.id ?? entry?.id;
    const rank = stat(entry, ["rank"]);
    const played = stat(entry, ["gamesplayed", "gp"]);
    const won = stat(entry, ["wins", "w"]);
    const drawn = stat(entry, ["ties", "draws", "d"]);
    const lost = stat(entry, ["losses", "l"]);
    const gd = stat(entry, ["pointdifferential", "goaldifference", "gd"]);
    const points = stat(entry, ["points", "pts"]);
    if (
      typeof club !== "string" ||
      clubId == null ||
      [rank, played, won, drawn, lost, gd, points].some((value) => value == null)
    ) {
      return [];
    }
    const formText = String(
      (entry?.stats ?? []).find((item: any) =>
        ["form", "lastfive"].includes(
          String(item?.name ?? item?.type).toLowerCase(),
        ),
      )?.displayValue ?? "",
    ).toUpperCase();
    const form = [...formText].filter(
      (value): value is "W" | "D" | "L" =>
        value === "W" || value === "D" || value === "L",
    );
    return [
      {
        rank: rank!,
        club,
        club_id: String(clubId),
        played: played!,
        won: won!,
        drawn: drawn!,
        lost: lost!,
        gd: gd!,
        points: points!,
        form,
      },
    ];
  });
  return rows.length ? rows.sort((a, b) => a.rank - b.rank) : null;
}

export async function fetchEspnStandings(
  signal?: AbortSignal,
): Promise<CompetitionStanding[] | null> {
  try {
    const response = await fetch(ESPN_STANDINGS_URL, {
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;
    return parseEspnStandings(await response.json());
  } catch {
    return null;
  }
}
