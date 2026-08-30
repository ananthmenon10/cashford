import { ANALYTICS_COPY } from "./analytics-copy";
import { modalOutcome, predictionOutcome } from "./analytics-habits";
import type {
  CorpusEntryResult,
  CorpusFixture,
  CorpusPick,
  SeasonPickCorpus,
} from "./analytics-corpus-load";

export type WeeklyLabelKey = "oracle" | "nearly" | "crowd" | "maverick";

export type WeeklyLabel = {
  key: WeeklyLabelKey;
  emoji: string;
  name: string;
  /** null is a DESIGNED state (tie or nobody clears the bar), never an error. */
  awarded: {
    userId: string;
    name: string;
    isViewer: boolean;
    value: number;
    runnerUp: number;
  } | null;
  /** Set exactly when `awarded` is null. One of the ANALYTICS_COPY label-reason strings. */
  notAwardedReason: string | null;
};

export type AnalyticsWeeklyLabels = {
  gwNumber: number;
  entrantCount: number;
  countedFixtures: number;
  labels: WeeklyLabel[];
};

type LabelDefinition = {
  key: WeeklyLabelKey;
  emoji: string;
  name: string;
  bar: number;
};

function fixtureKey(gwNumber: number, fixtureId: string): string {
  return `${gwNumber}:${fixtureId}`;
}

function entryKey(userId: string, gwNumber: number): string {
  return `${userId}:${gwNumber}`;
}

function pickKey(userId: string, gwNumber: number, fixtureId: string): string {
  return `${userId}:${fixtureKey(gwNumber, fixtureId)}`;
}

function modalScoreline(picks: readonly CorpusPick[]): string | null {
  const counts = new Map<string, number>();
  for (const pick of picks) {
    const scoreline = `${pick.predHome}:${pick.predAway}`;
    counts.set(scoreline, (counts.get(scoreline) ?? 0) + 1);
  }
  const highest = Math.max(...counts.values(), 0);
  if (highest < 2) return null;
  const top = [...counts.entries()].filter(([, count]) => count === highest);
  return top.length === 1 ? top[0][0] : null;
}

function labelFor(
  definition: LabelDefinition,
  entrants: readonly string[],
  scores: ReadonlyMap<string, number>,
  names: ReadonlyMap<string, string>,
  viewerId: string,
): WeeklyLabel {
  const values = entrants.map((userId) => scores.get(userId) ?? 0);
  const highest = Math.max(...values, 0);
  const leaders = entrants.filter((userId) => (scores.get(userId) ?? 0) === highest);
  if (highest < definition.bar) {
    return {
      key: definition.key,
      emoji: definition.emoji,
      name: definition.name,
      awarded: null,
      notAwardedReason: ANALYTICS_COPY.weeklyLabelNoBar(definition.name),
    };
  }
  if (leaders.length !== 1) {
    return {
      key: definition.key,
      emoji: definition.emoji,
      name: definition.name,
      awarded: null,
      notAwardedReason: ANALYTICS_COPY.weeklyLabelTie(definition.name),
    };
  }

  const winner = leaders[0];
  const runnerUp = Math.max(
    ...entrants.filter((userId) => userId !== winner).map((userId) => scores.get(userId) ?? 0),
    0,
  );
  const value = scores.get(winner) ?? 0;
  return {
    key: definition.key,
    emoji: definition.emoji,
    name: definition.name,
    awarded: {
      userId: winner,
      name: names.get(winner) ?? ANALYTICS_COPY.weeklyLabelPlayer,
      isViewer: winner === viewerId,
      value,
      runnerUp,
    },
    notAwardedReason: null,
  };
}

function resultsByEntrantAndGameweek(
  results: readonly CorpusEntryResult[],
): Map<string, CorpusEntryResult[]> {
  const grouped = new Map<string, CorpusEntryResult[]>();
  for (const result of results) {
    const key = entryKey(result.userId, result.gwNumber);
    const rows = grouped.get(key) ?? [];
    rows.push(result);
    grouped.set(key, rows);
  }
  return grouped;
}

function storedVerdict(
  groupedResults: ReadonlyMap<string, readonly CorpusEntryResult[]>,
  userId: string,
  gwNumber: number,
  fixtureId: string,
): CorpusEntryResult["perFixture"][number]["verdict"] | null {
  for (const result of groupedResults.get(entryKey(userId, gwNumber)) ?? []) {
    const row = result.perFixture.find((item) => item.fixtureId === fixtureId);
    if (row) return row.verdict;
  }
  return null;
}

function scoreOracle(
  entrants: readonly string[],
  targetGw: number,
  countedFixtureKeys: ReadonlySet<string>,
  groupedResults: ReadonlyMap<string, readonly CorpusEntryResult[]>,
): Map<string, number> {
  const scores = new Map(entrants.map((userId) => [userId, 0]));
  for (const userId of entrants) {
    let value = 0;
    for (const result of groupedResults.get(entryKey(userId, targetGw)) ?? []) {
      for (const row of result.perFixture) {
        if (row.verdict === "exact" && countedFixtureKeys.has(fixtureKey(targetGw, row.fixtureId))) {
          value += 1;
        }
      }
    }
    scores.set(userId, value);
  }
  return scores;
}

function scoreNearly(
  entrants: readonly string[],
  countedFixtures: readonly CorpusFixture[],
  picks: ReadonlyMap<string, CorpusPick>,
): Map<string, number> {
  const scores = new Map(entrants.map((userId) => [userId, 0]));
  for (const userId of entrants) {
    let value = 0;
    for (const fixture of countedFixtures) {
      const pick = picks.get(pickKey(userId, fixture.gwNumber, fixture.fixtureId));
      if (
        pick &&
        Math.abs(pick.predHome - fixture.ftHome!) + Math.abs(pick.predAway - fixture.ftAway!) === 1
      ) {
        value += 1;
      }
    }
    scores.set(userId, value);
  }
  return scores;
}

function scoreCrowd(
  entrants: readonly string[],
  countedFixtures: readonly CorpusFixture[],
  picks: ReadonlyMap<string, CorpusPick>,
): Map<string, number> {
  const scores = new Map(entrants.map((userId) => [userId, 0]));
  for (const fixture of countedFixtures) {
    const fixturePicks = entrants
      .map((userId) => picks.get(pickKey(userId, fixture.gwNumber, fixture.fixtureId)))
      .filter((pick): pick is CorpusPick => pick != null);
    const modal = modalScoreline(fixturePicks);
    if (modal == null) continue;
    for (const userId of entrants) {
      const pick = picks.get(pickKey(userId, fixture.gwNumber, fixture.fixtureId));
      if (pick && `${pick.predHome}:${pick.predAway}` === modal) {
        scores.set(userId, (scores.get(userId) ?? 0) + 1);
      }
    }
  }
  return scores;
}

function scoreMaverick(
  entrants: readonly string[],
  targetGw: number,
  countedFixtures: readonly CorpusFixture[],
  picks: ReadonlyMap<string, CorpusPick>,
  groupedResults: ReadonlyMap<string, readonly CorpusEntryResult[]>,
): Map<string, number> {
  const scores = new Map(entrants.map((userId) => [userId, 0]));
  for (const fixture of countedFixtures) {
    const fixturePicks = entrants
      .map((userId) => picks.get(pickKey(userId, targetGw, fixture.fixtureId)))
      .filter((pick): pick is CorpusPick => pick != null);
    const modal = modalOutcome(fixturePicks);
    if (modal == null) continue;
    for (const userId of entrants) {
      const pick = picks.get(pickKey(userId, targetGw, fixture.fixtureId));
      if (!pick || predictionOutcome(pick) === modal) continue;
      const verdict = storedVerdict(groupedResults, userId, targetGw, fixture.fixtureId);
      if (verdict === "exact" || verdict === "result") {
        scores.set(userId, (scores.get(userId) ?? 0) + 1);
      }
    }
  }
  return scores;
}

export function buildWeeklyLabels(
  corpus: SeasonPickCorpus,
  viewerId: string,
): AnalyticsWeeklyLabels | null {
  if (corpus.gameweeks.length === 0) return null;
  const targetGameweek = corpus.gameweeks.reduce((latest, gameweek) =>
    gameweek.gwNumber > latest.gwNumber ? gameweek : latest,
  );
  const entrants = targetGameweek.entrantIds;
  if (entrants.length < 2) return null;

  const countedFixtures = corpus.fixtures.filter(
    (fixture) =>
      fixture.gwNumber === targetGameweek.gwNumber &&
      fixture.state === "final" &&
      fixture.ftHome != null &&
      fixture.ftAway != null,
  );
  if (countedFixtures.length === 0) return null;

  const countedFixtureKeys = new Set(
    countedFixtures.map((fixture) => fixtureKey(fixture.gwNumber, fixture.fixtureId)),
  );
  const entrantSet = new Set(entrants);
  const picks = new Map<string, CorpusPick>();
  for (const pick of corpus.picks) {
    if (
      pick.gwNumber !== targetGameweek.gwNumber ||
      !entrantSet.has(pick.userId) ||
      !countedFixtureKeys.has(fixtureKey(pick.gwNumber, pick.fixtureId))
    ) {
      continue;
    }
    const key = pickKey(pick.userId, pick.gwNumber, pick.fixtureId);
    if (!picks.has(key)) picks.set(key, pick);
  }

  const groupedResults = resultsByEntrantAndGameweek(corpus.results);
  const names = new Map(corpus.members.map((member) => [member.userId, member.name]));
  const crowdBar = Math.ceil(countedFixtures.length * 0.6);
  const definitions: LabelDefinition[] = [
    {
      key: "oracle",
      emoji: "🔮",
      name: ANALYTICS_COPY.weeklyLabelOracle,
      bar: 1,
    },
    {
      key: "nearly",
      emoji: "😩",
      name: ANALYTICS_COPY.weeklyLabelNearly,
      bar: 2,
    },
    {
      key: "crowd",
      emoji: "🐑",
      name: ANALYTICS_COPY.weeklyLabelCrowd,
      bar: crowdBar,
    },
    {
      key: "maverick",
      emoji: "🎲",
      name: ANALYTICS_COPY.weeklyLabelMaverick,
      bar: 2,
    },
  ];
  const scores: Record<WeeklyLabelKey, Map<string, number>> = {
    oracle: scoreOracle(entrants, targetGameweek.gwNumber, countedFixtureKeys, groupedResults),
    nearly: scoreNearly(entrants, countedFixtures, picks),
    crowd: scoreCrowd(entrants, countedFixtures, picks),
    maverick: scoreMaverick(entrants, targetGameweek.gwNumber, countedFixtures, picks, groupedResults),
  };

  return {
    gwNumber: targetGameweek.gwNumber,
    entrantCount: entrants.length,
    countedFixtures: countedFixtures.length,
    labels: definitions.map((definition) =>
      labelFor(definition, entrants, scores[definition.key], names, viewerId),
    ),
  };
}
