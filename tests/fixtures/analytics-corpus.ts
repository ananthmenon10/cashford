import type {
  CorpusFixture,
  CorpusPick,
  CorpusEntryResult,
  SeasonPickCorpus,
} from "../../lib/analytics-corpus-load";

export const ANALYTICS_USERS = ["u1", "u2", "u3", "u4"] as const;

export function settledFixture(
  fixtureId: string,
  gwNumber: number,
  ftHome = 2,
  ftAway = 1,
): CorpusFixture {
  return {
    fixtureId,
    gwNumber,
    state: "final",
    ftHome,
    ftAway,
    homeTeamId: `home-${fixtureId}`,
    awayTeamId: `away-${fixtureId}`,
    homeName: "Home FC",
    homeShort: "HOM",
    awayName: "Away FC",
    awayShort: "AWY",
  };
}

export function pick(
  userId: string,
  fixtureId: string,
  predHome: number,
  predAway: number,
  gwNumber = 1,
): CorpusPick {
  return { userId, gwNumber, fixtureId, predHome, predAway };
}

export function result(
  userId: string,
  gwNumber: number,
  fixtureId: string,
  verdict: "exact" | "result" | "miss" | "void" = "result",
  points = verdict === "exact" ? 3 : verdict === "result" ? 1 : 0,
): CorpusEntryResult {
  return {
    userId,
    gwNumber,
    points,
    exacts: verdict === "exact" ? 1 : 0,
    goalError: verdict === "void" ? 0 : 1,
    perFixture: [{ fixtureId, verdict, pts: points as 0 | 1 | 3 }],
  };
}

export function emptyCorpus(
  overrides: Partial<SeasonPickCorpus> = {},
): SeasonPickCorpus {
  return {
    leagueId: "league",
    competitionId: "competition",
    members: ANALYTICS_USERS.map((userId, index) => ({
      userId,
      name: ["Ananth", "Dheeraj", "Kiran", "Rohan"][index],
      isViewer: userId === "u1",
    })),
    gameweeks: [],
    excludedGameweeks: [],
    fixtures: [],
    picks: [],
    results: [],
    ...overrides,
  };
}
