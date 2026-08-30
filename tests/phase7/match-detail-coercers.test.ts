import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  coerceLineups,
  coercePlayerStats,
  coerceShots,
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

describe("match detail coercers", () => {
  it("keeps real player rows, maps player to name, and drops the null rating field", () => {
    const rows = coercePlayerStats(sample.player_stats);

    expect(rows).toHaveLength(40);
    expect(rows?.[0]).toMatchObject({
      name: "Antonín Kinsky",
      team: "home",
    });
    expect(rows?.every((row) => !("rating" in row))).toBe(true);

    const coerced = coercePlayerStats([
      { player: "Bad team", team: "neutral", goals: 1 },
      { name: "Missing numerics", team: "away" },
    ]);
    expect(coerced).toEqual([
      {
        name: "Missing numerics",
        team: "away",
        goals: 0,
        assists: 0,
        totalShots: 0,
        shotsOnTarget: 0,
        saves: 0,
        goalsConceded: 0,
        yellowCards: 0,
        redCards: 0,
      },
    ]);
    expect(coercePlayerStats([{ player: "Bad team", team: "neutral" }])).toBe(
      undefined,
    );
  });

  it("requires both complete enough lineups and coerces shirt strings to numbers", () => {
    const lineups = coerceLineups(sample.lineups);

    expect(lineups).toBeDefined();
    expect(lineups?.home.formation).toBe("4-2-3-1");
    expect(lineups?.away.formation).toBe("4-2-3-1");
    expect(lineups?.away.players[0]).toEqual({
      name: "Lukás Hornícek",
      shirt: 21,
    });

    const sixPlayers = {
      ...sample.lineups,
      home: {
        ...(sample.lineups.home as Record<string, unknown>),
        players: (
          (sample.lineups.home as { players: unknown[] }).players
        ).slice(0, 6),
      },
    };
    expect(coerceLineups(sixPlayers)).toBeUndefined();

    const missingFormation = {
      ...sample.lineups,
      away: {
        ...(sample.lineups.away as Record<string, unknown>),
        formation: "",
      },
    };
    expect(coerceLineups(missingFormation)).toBeUndefined();
  });

  it("keeps valid shots, clamps coordinates, clamps xG at zero, and normalizes results", () => {
    expect(coerceShots(sample.shots)).toHaveLength(28);

    const shots = coerceShots([
      {
        ...(sample.shots[0] as Record<string, unknown>),
        x: -0.4,
        y: 1.4,
        xg: -0.2,
        result: "woodwork",
      },
      {
        ...(sample.shots[0] as Record<string, unknown>),
        x: undefined,
      },
      {
        ...(sample.shots[0] as Record<string, unknown>),
        result: undefined,
      },
    ]);

    expect(shots).toEqual([
      {
        x: 0,
        y: 1,
        xg: 0,
        minute: 14,
        player: "Mathys Tel",
        team: "home",
        result: "other",
      },
      {
        x: 0.8490000152587891,
        y: 0.6659999847412109,
        xg: 0.047795552760362625,
        minute: 14,
        player: "Mathys Tel",
        team: "home",
        result: "other",
      },
    ]);
    expect(coerceShots([{ x: 0, y: 0, xg: 0, minute: 1, team: "neutral", player: "X" }])).toBe(
      undefined,
    );
  });
});
