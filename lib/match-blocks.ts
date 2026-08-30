import { ageLabel } from "./view-format";
import type {
  MatchLineupSide,
  MatchPlayerStatRow,
  MatchShot,
  MatchSide,
} from "./match-types";

export type Sourced<T> = T & {
  source: string;
  fetchedAt: string;
  age: string;
};

function semanticallyEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const values = Object.values(value);
    return values.length === 0 || values.every(semanticallyEmpty);
  }
  return false;
}

export function sourcedBlock<T extends object>(
  value: T | null | undefined,
  meta: { ok: boolean; source: string; fetchedAt: string | null },
  now: Date,
): Sourced<T> | undefined {
  if (!meta.ok || !meta.fetchedAt || !value || semanticallyEmpty(value)) {
    return undefined;
  }
  return {
    ...value,
    source: meta.source,
    fetchedAt: meta.fetchedAt,
    age: ageLabel(meta.fetchedAt, now),
  };
}

export function arrayBlock<T>(
  values: readonly T[] | null | undefined,
  key: string,
  meta: { ok: boolean; source: string; fetchedAt: string | null },
  now: Date,
): Sourced<Record<string, readonly T[]>> | undefined {
  if (!values?.length) return undefined;
  return sourcedBlock({ [key]: values }, meta, now);
}

export function hasSemanticallyEmptyValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      !["notes", "yourCalls", "leagueOptions"].includes(key) &&
      (semanticallyEmpty(child) || hasSemanticallyEmptyValue(child)),
  );
}

type MatchLineups = { home: MatchLineupSide; away: MatchLineupSide };
type JoinedPlayerRow = MatchPlayerStatRow & {
  xg: number;
  shotCount: number;
};

function isMatchLineups(
  value: MatchLineups | readonly MatchPlayerStatRow[] | null | undefined,
): value is MatchLineups {
  return value != null && !Array.isArray(value);
}

export type SpotlightCard =
  | { kind: "xg"; player: string; team: MatchSide; xg: number }
  | {
      kind: "scorers";
      goals: number;
      players: Array<{ player: string; team: MatchSide; goals: number }>;
    }
  | {
      kind: "creators";
      assists: number;
      players: Array<{ player: string; team: MatchSide; assists: number }>;
    }
  | {
      kind: "keeper";
      player: string;
      team: MatchSide;
      saves: number;
      goalsConceded: number;
    };

export type LedgerEntry = {
  player: string;
  count: number;
  xg?: number;
  goalsConceded?: number;
  yellowCards: number;
  redCards: number;
};

export type LedgerCategory = {
  key: "goals" | "assists" | "cards" | "keeper" | "danger";
  home: LedgerEntry[];
  away: LedgerEntry[];
};

function playerNameCompare(
  left: { name: string },
  right: { name: string },
): number {
  return left.name.localeCompare(right.name);
}

function playerCompare(
  left: { player: string },
  right: { player: string },
): number {
  return left.player.localeCompare(right.player);
}

function normalizedName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function surname(value: string): string {
  const parts = value.trim().split(/\s+/);
  return normalizedName(parts[parts.length - 1] ?? "");
}

function rowIndexForShot(
  rows: readonly MatchPlayerStatRow[],
  shot: MatchShot,
): number | null {
  const candidates = rows.flatMap((row, index) =>
    row.team === shot.team ? [{ row, index }] : [],
  );
  const exact = candidates.find(({ row }) => row.name === shot.player);
  if (exact) return exact.index;

  const shotSurname = surname(shot.player);
  if (!shotSurname) return null;
  const surnameMatches = candidates.filter(
    ({ row }) => surname(row.name) === shotSurname,
  );
  return surnameMatches.length === 1 ? surnameMatches[0].index : null;
}

function joinedRows(
  rows: readonly MatchPlayerStatRow[],
  shots: readonly MatchShot[],
): JoinedPlayerRow[] {
  const totals = rows.map(() => ({ xg: 0, shotCount: 0 }));
  for (const shot of shots) {
    const index = rowIndexForShot(rows, shot);
    if (index == null) continue;
    totals[index].xg += shot.xg;
    totals[index].shotCount += 1;
  }
  return rows.map((row, index) => ({
    ...row,
    xg: totals[index].xg,
    shotCount: totals[index].shotCount,
  }));
}

export function keeperNames(
  lineups:
    | MatchLineups
    | readonly MatchPlayerStatRow[]
    | null
    | undefined,
  rows: readonly MatchPlayerStatRow[] = [],
): string[] {
  const lineupData = isMatchLineups(lineups) ? lineups : undefined;
  const fallbackRows = Array.isArray(lineups) ? lineups : rows;
  if (lineupData) {
    // ESPN does not mark keepers, and outfield goalsConceded values are non-zero;
    // the first player in each formation-ordered list is the keeper by assumption.
    return [lineupData.home.players[0]?.name, lineupData.away.players[0]?.name].filter(
      (name): name is string => Boolean(name),
    );
  }
  // Without lineups, saves are the only reliable keeper signal available here.
  return fallbackRows.filter((row) => row.saves > 0).map((row) => row.name);
}

export function playerXg(
  shots: readonly MatchShot[],
): Array<{ player: string; team: MatchSide; xg: number; shots: number }> {
  const totals = new Map<
    string,
    { player: string; team: MatchSide; xg: number; shots: number }
  >();
  for (const shot of shots) {
    const key = `${shot.team}:${shot.player}`;
    const current = totals.get(key) ?? {
      player: shot.player,
      team: shot.team,
      xg: 0,
      shots: 0,
    };
    current.xg += shot.xg;
    current.shots += 1;
    totals.set(key, current);
  }
  return [...totals.values()].sort(
    (left, right) => right.xg - left.xg || playerCompare(left, right),
  );
}

export function xgRace(shots: readonly MatchShot[]): {
  home: Array<{ minute: number; xg: number }>;
  away: Array<{ minute: number; xg: number }>;
  total: { home: number; away: number; combined: number };
} {
  const seriesFor = (team: MatchSide) => {
    let total = 0;
    const series = [{ minute: 0, xg: 0 }];
    for (const shot of shots
      .filter((candidate) => candidate.team === team)
      .slice()
      .sort((left, right) => left.minute - right.minute)) {
      total += shot.xg;
      series.push({ minute: shot.minute, xg: total });
    }
    return { series, total };
  };
  const home = seriesFor("home");
  const away = seriesFor("away");
  return {
    home: home.series,
    away: away.series,
    total: {
      home: home.total,
      away: away.total,
      combined: home.total + away.total,
    },
  };
}

function isKeeper(row: MatchPlayerStatRow, keepers: readonly string[]): boolean {
  return keepers.includes(row.name);
}

export function spotlights(
  rows: readonly MatchPlayerStatRow[],
  shots: readonly MatchShot[],
  keepers: readonly string[],
): SpotlightCard[] {
  const joined = joinedRows(rows, shots);
  const cards: SpotlightCard[] = [];
  const bestXg = joined
    .filter((row) => row.xg > 0)
    .sort((left, right) => right.xg - left.xg || playerNameCompare(left, right))[0];
  if (bestXg) {
    cards.push({
      kind: "xg",
      player: bestXg.name,
      team: bestXg.team,
      xg: bestXg.xg,
    });
  }

  const scorers = rows
    .filter((row) => row.goals > 0)
    .sort((left, right) => right.goals - left.goals || playerNameCompare(left, right));
  if (scorers.length) {
    cards.push({
      kind: "scorers",
      goals: scorers.reduce((total, row) => total + row.goals, 0),
      players: scorers.map((row) => ({
        player: row.name,
        team: row.team,
        goals: row.goals,
      })),
    });
  } else {
    const creators = rows
      .filter((row) => row.assists > 0)
      .sort((left, right) => right.assists - left.assists || playerNameCompare(left, right));
    if (creators.length) {
      cards.push({
        kind: "creators",
        assists: creators.reduce((total, row) => total + row.assists, 0),
        players: creators.map((row) => ({
          player: row.name,
          team: row.team,
          assists: row.assists,
        })),
      });
    }
  }

  const keeper = rows
    .filter((row) => isKeeper(row, keepers))
    .sort(
      (left, right) =>
        right.saves - left.saves ||
        left.goalsConceded - right.goalsConceded ||
        playerNameCompare(left, right),
    )[0];
  if (keeper) {
    cards.push({
      kind: "keeper",
      player: keeper.name,
      team: keeper.team,
      saves: keeper.saves,
      goalsConceded: keeper.goalsConceded,
    });
  }
  return cards;
}

function ledgerEntry(
  row: MatchPlayerStatRow,
  count: number,
  extra: { xg?: number; goalsConceded?: number } = {},
): LedgerEntry {
  return {
    player: row.name,
    count,
    ...extra,
    yellowCards: row.yellowCards,
    redCards: row.redCards,
  };
}

export function eventLedger(
  rows: readonly MatchPlayerStatRow[],
  shots: readonly MatchShot[],
  keepers: readonly string[],
): LedgerCategory[] {
  const joined = joinedRows(rows, shots);
  const categories: LedgerCategory[] = [];
  const addCategory = (
    key: LedgerCategory["key"],
    home: LedgerEntry[],
    away: LedgerEntry[],
  ) => {
    if (home.length || away.length) categories.push({ key, home, away });
  };

  addCategory(
    "goals",
    rows
      .filter((row) => row.team === "home" && row.goals > 0)
      .map((row) => ledgerEntry(row, row.goals)),
    rows
      .filter((row) => row.team === "away" && row.goals > 0)
      .map((row) => ledgerEntry(row, row.goals)),
  );
  addCategory(
    "assists",
    rows
      .filter((row) => row.team === "home" && row.assists > 0)
      .map((row) => ledgerEntry(row, row.assists)),
    rows
      .filter((row) => row.team === "away" && row.assists > 0)
      .map((row) => ledgerEntry(row, row.assists)),
  );
  addCategory(
    "cards",
    rows
      .filter(
        (row) => row.team === "home" && row.yellowCards + row.redCards > 0,
      )
      .map((row) => ledgerEntry(row, row.yellowCards + row.redCards)),
    rows
      .filter(
        (row) => row.team === "away" && row.yellowCards + row.redCards > 0,
      )
      .map((row) => ledgerEntry(row, row.yellowCards + row.redCards)),
  );
  addCategory(
    "keeper",
    rows
      .filter(
        (row) =>
          row.team === "home" &&
          isKeeper(row, keepers) &&
          (row.saves > 0 || row.goalsConceded > 0),
      )
      .map((row) =>
        ledgerEntry(row, row.saves, { goalsConceded: row.goalsConceded }),
      ),
    rows
      .filter(
        (row) =>
          row.team === "away" &&
          isKeeper(row, keepers) &&
          (row.saves > 0 || row.goalsConceded > 0),
      )
      .map((row) =>
        ledgerEntry(row, row.saves, { goalsConceded: row.goalsConceded }),
      ),
  );

  const dangerFor = (team: MatchSide) =>
    joined
      .filter((row) => row.team === team && row.xg > 0)
      .sort((left, right) => right.xg - left.xg || playerNameCompare(left, right))
      .slice(0, 2)
      .map((row) => ledgerEntry(row, row.shotCount, { xg: row.xg }));
  addCategory("danger", dangerFor("home"), dangerFor("away"));
  return categories;
}
