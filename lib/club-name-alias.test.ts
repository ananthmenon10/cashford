import { describe, expect, it } from "vitest";
import { toEspnClubName } from "./club-name-alias";

// The real 20 Premier League 2026-27 clubs, FPL short name on the left, ESPN displayName on the
// right — 8 diverge (the alias map), 12 already match. If any one of these 20 stops joining,
// the standings live-highlight silently drops that club's row.
const FPL_TO_ESPN: Array<[string, string]> = [
  ["Arsenal", "Arsenal"],
  ["Aston Villa", "Aston Villa"],
  ["Bournemouth", "AFC Bournemouth"],
  ["Brentford", "Brentford"],
  ["Brighton", "Brighton & Hove Albion"],
  ["Burnley", "Burnley"],
  ["Chelsea", "Chelsea"],
  ["Crystal Palace", "Crystal Palace"],
  ["Everton", "Everton"],
  ["Fulham", "Fulham"],
  ["Leeds", "Leeds United"],
  ["Liverpool", "Liverpool"],
  ["Man City", "Manchester City"],
  ["Man Utd", "Manchester United"],
  ["Newcastle", "Newcastle United"],
  ["Nott'm Forest", "Nottingham Forest"],
  ["Spurs", "Tottenham Hotspur"],
  ["Sunderland", "Sunderland"],
  ["West Ham", "West Ham"],
  ["Wolves", "Wolves"],
];

describe("toEspnClubName", () => {
  it("joins all 20 real Premier League 2026-27 clubs from FPL name to ESPN displayName", () => {
    expect(FPL_TO_ESPN).toHaveLength(20);
    for (const [fpl, espn] of FPL_TO_ESPN) {
      expect(toEspnClubName(fpl)).toBe(espn);
    }
  });
});
