import {
  type Entry,
  type FixtureResult,
  type GwInput,
} from "./gameweek-points";
import {
  gameweekNets,
  settleGameweek,
} from "./gameweek-settle";
import { rankGameweekScores } from "./gw-rank";

export type LiveFixture = {
  fixtureId: string;
  state: "upcoming" | "live" | "final" | "void";
  home: number | null;
  away: number | null;
};

export function buildLiveInput(input: {
  entries: Entry[];
  fixtures: LiveFixture[];
  stakeInr: number;
}): GwInput | null {
  const results: FixtureResult[] = [];
  for (const fixture of input.fixtures) {
    if (fixture.state === "void") {
      results.push({ fixtureId: fixture.fixtureId, state: "void" });
      continue;
    }
    if (
      (fixture.state === "live" || fixture.state === "final") &&
      fixture.home != null &&
      fixture.away != null
    ) {
      results.push({
        fixtureId: fixture.fixtureId,
        state: "final",
        home: fixture.home,
        away: fixture.away,
      });
    }
  }
  if (!results.some((result) => result.state === "final")) return null;
  return { entries: input.entries, results, stakeInr: input.stakeInr };
}

export function liveMoney(input: GwInput) {
  const outcome = settleGameweek(input);
  if (outcome.kind !== "settled") return null;
  const scores = outcome.scores;
  const nets = gameweekNets(outcome);
  const rankByUser = rankGameweekScores(scores);
  return scores.map((score) => ({
    userId: score.userId,
    points: score.points,
    netInr: nets.get(score.userId) ?? 0,
    winner: outcome.winners.includes(score.userId),
    rank: rankByUser.get(score.userId) ?? 0,
    fieldSize: scores.length,
    perFixture: score.perFixture,
  }));
}
