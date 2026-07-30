import type { Entry, FixtureResult, GwInput, Pick, UserScore } from "./gameweek-points";
import { settleGameweek } from "./gameweek-settle";

export type LiveFixture = {
  fixtureId: string;
  state: "active" | "void";
  status?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
};

export type ProvisionalStanding = UserScore & { rank: number };

export type ProvisionalGameweek =
  | {
      state: "available";
      standings: ProvisionalStanding[];
      finalFixtures: number;
      totalFixtures: number;
    }
  | {
      state: "unavailable";
      standings?: never;
      finalFixtures: number;
      totalFixtures: number;
    };

export function buildProvisionalInput(input: {
  entries: readonly Entry[];
  fixtures: readonly LiveFixture[];
  stakeInr: number;
}): GwInput {
  const results: FixtureResult[] = [];
  for (const fixture of input.fixtures) {
    if (fixture.state === "void") {
      results.push({ fixtureId: fixture.fixtureId, state: "void" });
      continue;
    }
    if (
      fixture.status === "finished" &&
      fixture.homeScore != null &&
      fixture.awayScore != null
    ) {
      results.push({
        fixtureId: fixture.fixtureId,
        state: "final",
        home: fixture.homeScore,
        away: fixture.awayScore,
      });
    }
  }
  return {
    entries: input.entries.map((entry) => ({
      userId: entry.userId,
      picks: entry.picks.map((pick: Pick) => ({ ...pick })),
    })),
    results,
    stakeInr: input.stakeInr,
  };
}

function ranked(scores: readonly UserScore[]): ProvisionalStanding[] {
  const sorted = [...scores].sort(
    (a, b) =>
      b.points - a.points ||
      b.exacts - a.exacts ||
      a.goalError - b.goalError ||
      a.userId.localeCompare(b.userId),
  );
  let priorKey = "";
  let priorRank = 0;
  return sorted.map((score, index) => {
    const key = `${score.points}:${score.exacts}:${score.goalError}`;
    if (key !== priorKey) priorRank = index + 1;
    priorKey = key;
    return { ...score, rank: priorRank };
  });
}

export function provisionalGameweek(input: {
  entries: readonly Entry[];
  fixtures: readonly LiveFixture[];
  stakeInr: number;
}): ProvisionalGameweek {
  const engineInput = buildProvisionalInput(input);
  const finalFixtures = engineInput.results.filter((result) => result.state === "final").length;
  const totalFixtures = input.fixtures.filter(
    (fixture) => fixture.state === "active",
  ).length;
  try {
    const outcome = buildLiveOutcome({
      activeFixtures: input.fixtures
        .filter((fixture) => fixture.state === "active")
        .map((fixture) => ({
          fixtureId: fixture.fixtureId,
          final:
            fixture.status === "finished" &&
            fixture.homeScore != null &&
            fixture.awayScore != null,
          home: fixture.homeScore ?? undefined,
          away: fixture.awayScore ?? undefined,
        })),
      voidFixtures: input.fixtures
        .filter((fixture) => fixture.state === "void")
        .map((fixture) => fixture.fixtureId),
      entries: input.entries,
      stakeInr: input.stakeInr,
    });
    if (outcome.kind !== "settled") {
      return { state: "unavailable", finalFixtures, totalFixtures };
    }
    return {
      state: "available",
      standings: ranked(outcome.scores),
      finalFixtures,
      totalFixtures,
    };
  } catch {
    return { state: "unavailable", finalFixtures, totalFixtures };
  }
}

type LiveOutcomeInput = {
  activeFixtures: readonly {
    fixtureId: string;
    final: boolean;
    home?: number;
    away?: number;
  }[];
  voidFixtures: readonly (string | { fixtureId: string })[];
  entries: readonly Entry[];
  stakeInr: number;
};

export type LiveOutcome =
  | {
      kind: "settled";
      scores: UserScore[];
      winners: string[];
      tiebreakUsed: string;
      diagnostics: string[];
    }
  | { kind: "void"; reason: string }
  | { kind: "unavailable"; scores: readonly never[] };

export function buildLiveOutcome(input: LiveOutcomeInput): LiveOutcome {
  const engineInput = buildProvisionalInput({
    entries: input.entries,
    fixtures: [
      ...input.activeFixtures.map((fixture) => ({
        fixtureId: fixture.fixtureId,
        state: "active" as const,
        status: fixture.final ? "finished" : null,
        homeScore: fixture.home ?? null,
        awayScore: fixture.away ?? null,
      })),
      ...input.voidFixtures.map((fixture) => ({
        fixtureId: typeof fixture === "string" ? fixture : fixture.fixtureId,
        state: "void" as const,
      })),
    ],
    stakeInr: input.stakeInr,
  });
  if (engineInput.results.length === 0) {
    return { kind: "unavailable", scores: [] };
  }
  const included = new Set(engineInput.results.map((result) => result.fixtureId));
  const outcome = settleGameweek({
    ...engineInput,
    entries: engineInput.entries.map((entry) => ({
      ...entry,
      picks: entry.picks.filter((pick) => included.has(pick.fixtureId)),
    })),
  });
  if (outcome.kind === "void") return outcome;
  return {
    kind: "settled",
    scores: outcome.scores,
    winners: outcome.winners,
    tiebreakUsed: outcome.tiebreakUsed,
    diagnostics: outcome.diagnostics,
  };
}
