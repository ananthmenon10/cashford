import type {
  CorpusEntryResult,
  CorpusFixture,
  CorpusPick,
  SeasonPickCorpus,
} from "./analytics-corpus-load";

export type HabitSplit = {
  count: number;
  rate: number | null;
};

export type AnalyticsHabits = {
  gameweeks: number[];
  excludedGameweeks?: SeasonPickCorpus["excludedGameweeks"];
  pickCount: number;
  mostCalled: { predHome: number; predAway: number; count: number } | null;
  drawRate: number | null;
  actualDrawRate: number | null;
  homeBias: number | null;
  actualHomeWinRate: number | null;
  averageGoalsPredicted: number | null;
  averageGoalsScored: number | null;
  goalsDelta: number | null;
  consensus: {
    withCrowd: HabitSplit;
    against: HabitSplit & { correct: number | null };
    noConsensus: HabitSplit;
  };
  sentence: { againstCorrect: number; againstCount: number } | null;
};

type Outcome = "home" | "draw" | "away";

function fixtureKey(gwNumber: number, fixtureId: string): string {
  return `${gwNumber}:${fixtureId}`;
}

function outcome(home: number | null, away: number | null): Outcome | null {
  if (home == null || away == null) return null;
  if (home === away) return "draw";
  return home > away ? "home" : "away";
}

function predictionOutcome(pick: CorpusPick): Outcome {
  if (pick.predHome === pick.predAway) return "draw";
  return pick.predHome > pick.predAway ? "home" : "away";
}

function scorelineCounts(picks: readonly CorpusPick[]) {
  const counts = new Map<string, { predHome: number; predAway: number; count: number }>();
  for (const pick of picks) {
    const key = `${pick.predHome}:${pick.predAway}`;
    const current = counts.get(key) ?? {
      predHome: pick.predHome,
      predAway: pick.predAway,
      count: 0,
    };
    current.count += 1;
    counts.set(key, current);
  }
  return counts;
}

function uniqueTop<T>(values: readonly T[], score: (value: T) => number): T | null {
  if (values.length === 0) return null;
  const highest = Math.max(...values.map(score));
  const top = values.filter((value) => score(value) === highest);
  return top.length === 1 ? top[0] : null;
}

function resultFor(
  results: readonly CorpusEntryResult[],
  userId: string,
  gwNumber: number,
  fixtureId: string,
): "exact" | "result" | "miss" | "void" | null {
  for (const result of results) {
    if (result.userId !== userId || result.gwNumber !== gwNumber) continue;
    const verdict = result.perFixture.find((row) => row.fixtureId === fixtureId)?.verdict;
    if (verdict) return verdict;
  }
  return null;
}

function fixtureMap(fixtures: readonly CorpusFixture[]) {
  const byId = new Map<string, CorpusFixture>();
  for (const fixture of fixtures) {
    const key = fixtureKey(fixture.gwNumber, fixture.fixtureId);
    if (!byId.has(key)) byId.set(key, fixture);
  }
  return byId;
}

function split(count: number, total: number): HabitSplit {
  return { count, rate: total > 0 ? count / total : null };
}

export function buildPredictionHabits(
  corpus: SeasonPickCorpus,
  viewerId: string,
): AnalyticsHabits | null {
  const fixtures = fixtureMap(corpus.fixtures);
  const viewerPicks = corpus.picks.filter((pick) => {
    const fixture = fixtures.get(fixtureKey(pick.gwNumber, pick.fixtureId));
    return pick.userId === viewerId && fixture?.state === "final" &&
      fixture.ftHome != null && fixture.ftAway != null;
  });
  if (viewerPicks.length < 20) return null;

  const scorelines = scorelineCounts(viewerPicks);
  const mostCalled = uniqueTop([...scorelines.values()], (value) => value.count);
  let drawPredictions = 0;
  let homePredictions = 0;
  let actualDraws = 0;
  let actualHomeWins = 0;
  let predictedGoals = 0;
  let scoredGoals = 0;
  let actualCount = 0;
  for (const pick of viewerPicks) {
    const fixture = fixtures.get(fixtureKey(pick.gwNumber, pick.fixtureId))!;
    const predicted = predictionOutcome(pick);
    if (predicted === "draw") drawPredictions += 1;
    if (predicted === "home") homePredictions += 1;
    const actual = outcome(fixture.ftHome, fixture.ftAway);
    if (actual === "draw") actualDraws += 1;
    if (actual === "home") actualHomeWins += 1;
    predictedGoals += pick.predHome + pick.predAway;
    scoredGoals += fixture.ftHome! + fixture.ftAway!;
    if (actual) actualCount += 1;
  }

  const picksByFixture = new Map<string, CorpusPick[]>();
  for (const pick of corpus.picks) {
    const key = fixtureKey(pick.gwNumber, pick.fixtureId);
    const list = picksByFixture.get(key) ?? [];
    list.push(pick);
    picksByFixture.set(key, list);
  }
  let withCrowd = 0;
  let against = 0;
  let noConsensus = 0;
  let againstCorrect = 0;
  let againstWithVerdict = 0;
  for (const pick of viewerPicks) {
    const roomPicks = picksByFixture.get(fixtureKey(pick.gwNumber, pick.fixtureId)) ?? [];
    const modes = new Map<Outcome, number>();
    for (const roomPick of roomPicks) {
      const predicted = predictionOutcome(roomPick);
      modes.set(predicted, (modes.get(predicted) ?? 0) + 1);
    }
    const modal = uniqueTop([...modes.keys()], (value) => modes.get(value) ?? 0);
    if (!modal) {
      noConsensus += 1;
      continue;
    }
    if (predictionOutcome(pick) === modal) {
      withCrowd += 1;
      continue;
    }
    against += 1;
    const verdict = resultFor(corpus.results, viewerId, pick.gwNumber, pick.fixtureId);
    if (verdict) {
      againstWithVerdict += 1;
      if (verdict === "exact" || verdict === "result") againstCorrect += 1;
    }
  }

  const total = viewerPicks.length;
  return {
    gameweeks: [...new Set(
      viewerPicks
        .map((pick) => fixtures.get(fixtureKey(pick.gwNumber, pick.fixtureId))?.gwNumber)
        .filter((gwNumber): gwNumber is number => gwNumber != null),
    )].sort((a, b) => a - b),
    excludedGameweeks: corpus.excludedGameweeks,
    pickCount: total,
    mostCalled,
    drawRate: total > 0 ? drawPredictions / total : null,
    actualDrawRate: actualCount > 0 ? actualDraws / actualCount : null,
    homeBias: total > 0 ? homePredictions / total : null,
    actualHomeWinRate: actualCount > 0 ? actualHomeWins / actualCount : null,
    averageGoalsPredicted: total > 0 ? predictedGoals / total : null,
    averageGoalsScored: actualCount > 0 ? scoredGoals / actualCount : null,
    goalsDelta: actualCount > 0 ? predictedGoals / total - scoredGoals / actualCount : null,
    consensus: {
      withCrowd: split(withCrowd, total),
      against: {
        ...split(against, total),
        correct: againstWithVerdict === against && against > 0
          ? againstCorrect / against
          : null,
      },
      noConsensus: split(noConsensus, total),
    },
    sentence:
      against >= 5 && againstWithVerdict === against
        ? { againstCorrect, againstCount: against }
        : null,
  };
}
