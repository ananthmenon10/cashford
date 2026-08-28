import { sortFixturesByKickoff } from "./fixture-order";

export type PointGridVerdict = "exact" | "result" | "miss" | "void";

export type PointGridCell = {
  pick: [number, number] | null;
  points: 0 | 1 | 3 | null;
  verdict: PointGridVerdict | null;
};

export type PointGridFixture = {
  fixtureId: string;
  homeName: string;
  awayName: string;
  kickoffAt: string | null;
  status: string;
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
  state: "active" | "void";
  matchHref: string;
};

export type PointGridEntrant = {
  entryId: string;
  userId: string;
  name: string;
  initials: string;
  isViewer: boolean;
  totalPoints: number | null;
};

export type PointGridRow = {
  fixture: PointGridFixture;
  cells: PointGridCell[];
};

export type PointGridView = {
  leagueId: string;
  leagueName: string;
  gameweekNumber: number;
  viewerId: string;
  entrants: PointGridEntrant[];
  rows: PointGridRow[];
};

export type PointGridPick = {
  fixtureId: string;
  predHome: number;
  predAway: number;
};

export type PointGridEntry = {
  entryId: string;
  userId: string;
  name: string;
  initials?: string;
  status: string;
  picks: PointGridPick[];
};

export type PointGridFixtureInput = PointGridFixture & {
  externalId?: number | string | null;
};

export type PointGridSnapshotCell = {
  points?: 0 | 1 | 3 | null;
  verdict?: PointGridVerdict | null;
};

export type PointGridSnapshot = {
  totalPoints?: number | null;
  cells?: Record<string, PointGridSnapshotCell>;
};

export type PointGridInput = {
  leagueId: string;
  leagueName: string;
  gameweekNumber: number;
  viewerId: string;
  mode: "live" | "settled";
  entries: PointGridEntry[];
  fixtures: PointGridFixtureInput[];
  snapshots?: Record<string, PointGridSnapshot>;
};

type Grade = Pick<PointGridCell, "points" | "verdict">;

const sign = (value: number): -1 | 0 | 1 =>
  value < 0 ? -1 : value > 0 ? 1 : 0;

// Deliberately mirrors gradeFinal in lib/gameweek-points.ts (exact 3 / correct result 1 / miss 0)
// because that module's strict scoreGameweek throws on a partly-played gameweek; keep them in step if scoring changes.
function gradePick(pick: PointGridPick, fixture: PointGridFixture): Grade | null {
  if (fixture.state === "void") return { points: 0, verdict: "void" };
  if (fixture.status !== "live" && fixture.status !== "finished") return null;
  if (fixture.homeScore === null || fixture.awayScore === null) return null;

  if (pick.predHome === fixture.homeScore && pick.predAway === fixture.awayScore) {
    return { points: 3, verdict: "exact" };
  }
  if (
    sign(pick.predHome - pick.predAway) ===
    sign(fixture.homeScore - fixture.awayScore)
  ) {
    return { points: 1, verdict: "result" };
  }
  return { points: 0, verdict: "miss" };
}

function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function cellPick(entry: PointGridEntry, fixtureId: string): PointGridPick | null {
  const pick = entry.picks.find((candidate) => candidate.fixtureId === fixtureId);
  return pick ?? null;
}

export function buildPointGrid(input: PointGridInput): PointGridView {
  const entries = input.entries.filter((entry) => entry.status === "locked_in");
  const fixtures = sortFixturesByKickoff(
    input.fixtures.map((fixture) => ({ ...fixture, id: fixture.fixtureId })),
  );

  const rows = fixtures.map((fixture) => {
    const outputFixture: PointGridFixture = {
      fixtureId: fixture.fixtureId,
      homeName: fixture.homeName,
      awayName: fixture.awayName,
      kickoffAt: fixture.kickoffAt,
      status: fixture.status,
      minute: fixture.minute,
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
      state: fixture.state,
      matchHref: fixture.matchHref,
    };

    const cells = entries.map((entry) => {
      const pick = cellPick(entry, fixture.fixtureId);
      const pickedScore: [number, number] | null = pick
        ? [pick.predHome, pick.predAway]
        : null;

      if (input.mode === "settled") {
        const stored = input.snapshots?.[entry.entryId]?.cells?.[fixture.fixtureId];
        return {
          pick: pickedScore,
          points: stored?.points ?? null,
          verdict: stored?.verdict ?? null,
        };
      }

      const grade = pick ? gradePick(pick, fixture) : fixture.state === "void"
        ? { points: 0 as const, verdict: "void" as const }
        : null;
      return {
        pick: pickedScore,
        points: grade?.points ?? null,
        verdict: grade?.verdict ?? null,
      };
    });

    return { fixture: outputFixture, cells };
  });

  const entrants = entries.map((entry) => {
    let totalPoints: number | null = null;
    if (input.mode === "settled") {
      totalPoints = input.snapshots?.[entry.entryId]?.totalPoints ?? null;
    } else {
      const entryIndex = entries.indexOf(entry);
      const entrantCells = rows.map((row) => row.cells[entryIndex]);
      const gradedCells = entrantCells.filter((cell) => cell.verdict !== null);
      if (gradedCells.length > 0) {
        totalPoints = gradedCells.reduce((sum, cell) => sum + (cell.points ?? 0), 0);
      }
    }

    return {
      entryId: entry.entryId,
      userId: entry.userId,
      name: entry.name,
      initials: entry.initials && entry.initials.length > 0
        ? entry.initials
        : deriveInitials(entry.name),
      isViewer: entry.userId === input.viewerId,
      totalPoints,
    };
  });

  return {
    leagueId: input.leagueId,
    leagueName: input.leagueName,
    gameweekNumber: input.gameweekNumber,
    viewerId: input.viewerId,
    entrants,
    rows,
  };
}
