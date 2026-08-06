// fixtures/gameweek data are FPL-sourced (short club names); competition_standings rows are
// ESPN-sourced (ESPN's longer displayNames). 12 of the 20 Premier League 2026-27 clubs already
// match verbatim — this map covers the 8 that don't, so any code joining an FPL-shaped name
// against ESPN-shaped standings rows goes through one shared lookup instead of drifting.
export const CLUB_NAME_ALIAS: Readonly<Record<string, string>> = {
  Bournemouth: "AFC Bournemouth",
  Brighton: "Brighton & Hove Albion",
  Leeds: "Leeds United",
  "Man City": "Manchester City",
  "Man Utd": "Manchester United",
  Newcastle: "Newcastle United",
  "Nott'm Forest": "Nottingham Forest",
  Spurs: "Tottenham Hotspur",
};

/** Canonicalizes an FPL-sourced club name to its ESPN displayName for joins against
 * ESPN-derived standings data. The 12 already-matching names pass through unchanged. */
export function toEspnClubName(fplName: string): string {
  return CLUB_NAME_ALIAS[fplName] ?? fplName;
}
