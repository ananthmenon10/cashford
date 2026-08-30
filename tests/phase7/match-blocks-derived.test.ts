import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  eventLedger,
  keeperNames,
  playerXg,
  spotlights,
  xgRace,
  type LedgerCategory,
} from "../../lib/match-blocks";
import {
  coerceLineups,
  coercePlayerStats,
  coerceShots,
  type MatchPlayerStatRow,
  type MatchShot,
} from "../../lib/match-detail";

const sample = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "docs/design/throwaway/match-blocks-sample-data.json",
    ),
    "utf8",
  ),
) as {
  player_stats: unknown[];
  lineups: { home: unknown; away: unknown };
  shots: unknown[];
};

const rows = coercePlayerStats(sample.player_stats)!;
const lineups = coerceLineups(sample.lineups)!;
const shots = coerceShots(sample.shots)!;

function statRow(
  name: string,
  overrides: Partial<MatchPlayerStatRow> = {},
): MatchPlayerStatRow {
  return {
    name,
    team: "home",
    goals: 0,
    assists: 0,
    totalShots: 0,
    shotsOnTarget: 0,
    saves: 0,
    goalsConceded: 0,
    yellowCards: 0,
    redCards: 0,
    ...overrides,
  };
}

describe("pure match block builders", () => {
  it("identifies the first formation-ordered player per side, or save-makers without lineups", () => {
    expect(keeperNames(lineups)).toEqual([
      lineups.home.players[0].name,
      lineups.away.players[0].name,
    ]);
    expect(keeperNames(undefined, rows)).toEqual(["Lukás Hornícek"]);
  });

  it("sums player xG and ranks Wissa first in the golden fixture", () => {
    const ranked = playerXg(shots);
    const wissa = ranked.find((entry) => entry.player === "Yoane Wissa");

    expect(wissa?.xg).toBeCloseTo(0.6225, 4);
    expect(wissa?.shots).toBe(2);
    expect(ranked[0]).toMatchObject({ player: "Yoane Wissa", team: "away" });
  });

  it("builds non-decreasing cumulative xG races with a zero starting point", () => {
    const race = xgRace(shots);

    expect(race.total.combined).toBeCloseTo(2.147, 3);
    expect(race.home[0]).toEqual({ minute: 0, xg: 0 });
    expect(race.away[0]).toEqual({ minute: 0, xg: 0 });
    for (const series of [race.home, race.away]) {
      for (let index = 1; index < series.length; index += 1) {
        expect(series[index].xg).toBeGreaterThanOrEqual(series[index - 1].xg);
        expect(series[index].minute).toBeGreaterThanOrEqual(
          series[index - 1].minute,
        );
      }
    }
  });

  it("joins an unmatched shot surname onto the unique stats row", () => {
    const andy = rows.find((row) => row.name === "Andy Robertson")!;
    const andrewShot = shots.find((shot) => shot.player === "Andrew Robertson")!;

    const cards = spotlights([andy], [andrewShot], []);
    expect(cards[0]).toEqual({
      kind: "xg",
      player: "Andy Robertson",
      team: "home",
      xg: andrewShot.xg,
    });
  });

  it("orders the golden spotlights as xG, scorers, and keeper", () => {
    const cards = spotlights(rows, shots, keeperNames(lineups));
    const xgCard = cards.find((card) => card.kind === "xg");
    const scorerCard = cards.find((card) => card.kind === "scorers");
    const keeperCard = cards.find((card) => card.kind === "keeper");

    expect(cards.map((card) => card.kind)).toEqual([
      "xg",
      "scorers",
      "keeper",
    ]);
    expect(xgCard).toMatchObject({
      kind: "xg",
      player: "Yoane Wissa",
      team: "away",
    });
    expect((xgCard as { xg: number }).xg).toBeCloseTo(0.6225, 4);
    expect(scorerCard).toEqual({
      kind: "scorers",
      goals: 2,
      players: [
        { player: "Anthony Elanga", team: "away", goals: 1 },
        { player: "Yoane Wissa", team: "away", goals: 1 },
      ],
    });
    expect(keeperCard).toEqual({
      kind: "keeper",
      player: lineups.away.players[0].name,
      team: "away",
      saves: 4,
      goalsConceded: 0,
    });
  });

  it("uses creators in the scorer slot when nobody scored", () => {
    const noGoals = rows.map((row) => ({ ...row, goals: 0 }));
    const cards = spotlights(noGoals, shots, keeperNames(lineups));
    const creators = cards.find((card) => card.kind === "creators");

    expect(cards.some((card) => card.kind === "scorers")).toBe(false);
    expect(creators).toEqual({
      kind: "creators",
      assists: 2,
      players: [
        { player: "Amar Dedic", team: "away", assists: 1 },
        { player: "Nick Woltemade", team: "away", assists: 1 },
      ],
    });
    expect(
      spotlights(
        noGoals.map((row) => ({ ...row, assists: 0 })),
        [],
        [],
      ),
    ).toEqual([]);
  });

  it("uses name order for equal xG and fewer conceded goals for equal saves", () => {
    const equalXgRows = [statRow("Zed"), statRow("Ada")];
    const equalXgShots: MatchShot[] = [
      {
        x: 0.5,
        y: 0.5,
        xg: 0.2,
        minute: 1,
        player: "Zed",
        team: "home",
        result: "saved",
      },
      {
        x: 0.5,
        y: 0.5,
        xg: 0.2,
        minute: 2,
        player: "Ada",
        team: "home",
        result: "saved",
      },
    ];
    expect(spotlights(equalXgRows, equalXgShots, [])[0]).toEqual({
      kind: "xg",
      player: "Ada",
      team: "home",
      xg: 0.2,
    });

    const keepers = [
      statRow("Alpha", { saves: 4, goalsConceded: 2 }),
      statRow("Beta", { saves: 4, goalsConceded: 1 }),
    ];
    expect(spotlights(keepers, [], ["Alpha", "Beta"])).toEqual([
      {
        kind: "keeper",
        player: "Beta",
        team: "home",
        saves: 4,
        goalsConceded: 1,
      },
    ]);
  });

  it("does not use an ambiguous surname, while matching a unique surname across case and accents", () => {
    const uniqueRow = statRow("José Álvarez");
    const uniqueShot: MatchShot = {
      x: 0.5,
      y: 0.5,
      xg: 0.3,
      minute: 1,
      player: "Jose ALVAREZ",
      team: "home",
      result: "saved",
    };
    expect(spotlights([uniqueRow], [uniqueShot], [])[0]).toMatchObject({
      kind: "xg",
      player: "José Álvarez",
      xg: 0.3,
    });

    const ambiguousRows = [statRow("Ada Smith"), statRow("Bob Smith")];
    expect(
      spotlights(
        ambiguousRows,
        [{ ...uniqueShot, player: "Jordan Smith" }],
        [],
      ),
    ).toEqual([]);
  });

  it("builds contributor-only ledger categories with empty home goals and bounded danger", () => {
    const ledger = eventLedger(rows, shots, keeperNames(lineups));
    const goals = ledger.find((category) => category.key === "goals")!;
    const danger = ledger.find((category) => category.key === "danger")!;
    const keeper = ledger.find((category) => category.key === "keeper")!;

    expect(goals.home).toEqual([]);
    expect(goals.away).toHaveLength(2);
    expect(danger.home.length).toBeLessThanOrEqual(2);
    expect(danger.away.length).toBeLessThanOrEqual(2);
    expect(keeper.away).toContainEqual({
      player: "Lukás Hornícek",
      count: 4,
      goalsConceded: 0,
      yellowCards: 0,
      redCards: 0,
    });
    expect(
      ledger.every((category: LedgerCategory) =>
        ["goals", "assists", "cards", "keeper", "danger"].includes(
          category.key,
        ),
      ),
    ).toBe(true);
    expect(ledger.flatMap((category) => [...category.home, ...category.away]).every(
      (entry) => typeof entry.yellowCards === "number" && typeof entry.redCards === "number",
    )).toBe(true);
  });
});
