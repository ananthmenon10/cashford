import { describe, expect, it } from "vitest";
import { buildPredictionHabits } from "../../lib/analytics-habits";
import { emptyCorpus, pick, result, settledFixture } from "../fixtures/analytics-corpus";

function corpusWithPicks(count: number, againstCount = 0) {
  const fixtures = Array.from({ length: count }, (_, index) =>
    settledFixture(`f${index}`, 1, index % 2 === 0 ? 2 : 1, index % 2 === 0 ? 1 : 1),
  );
  const picks = fixtures.map((fixture, index) => {
    if (index < againstCount) return pick("u1", fixture.fixtureId, 0, 0);
    return pick("u1", fixture.fixtureId, 2, 1);
  });
  const roomPicks = fixtures.flatMap((fixture, index) => [
    pick("u2", fixture.fixtureId, index < againstCount ? 2 : 2, 1),
    pick("u3", fixture.fixtureId, 2, 1),
  ]);
  const results = fixtures.map((fixture, index) =>
    result("u1", 1, fixture.fixtureId, index < againstCount ? "miss" : "exact"),
  );
  return emptyCorpus({
    gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2", "u3"] }],
    fixtures,
    picks: [...picks, ...roomPicks],
    results,
  });
}

describe("buildPredictionHabits", () => {
  it("builds prediction-shaped habits and the consensus split from settled picks", () => {
    const habits = buildPredictionHabits(corpusWithPicks(20), "u1");
    expect(habits).not.toBeNull();
    expect(habits?.pickCount).toBe(20);
    expect(habits?.mostCalled?.count).toBe(20);
    expect(habits?.drawRate).toBe(0);
    expect(habits?.homeBias).toBe(1);
    expect(habits?.consensus.withCrowd.count).toBe(20);
    expect(habits?.consensus.against.count).toBe(0);
  });

  it("hides below twenty settled picks and handles a one-gameweek sample", () => {
    expect(buildPredictionHabits(corpusWithPicks(19), "u1")).toBeNull();
    expect(buildPredictionHabits(corpusWithPicks(20), "u1")?.gameweeks).toEqual([1]);
  });

  it("uses settled viewer picks rather than today's member list for a late joiner", () => {
    const corpus = corpusWithPicks(20);
    corpus.members.push({ userId: "late", name: "Late Joiner", isViewer: false });
    expect(buildPredictionHabits(corpus, "u1")?.pickCount).toBe(20);
    expect(buildPredictionHabits(corpus, "late")).toBeNull();
  });

  it("returns null actual-rate rows rather than a fabricated percentage", () => {
    const corpus = emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1"] }],
      fixtures: [settledFixture("f1", 1, null as never, null as never)],
      picks: [pick("u1", "f1", 2, 1)],
      results: [result("u1", 1, "f1", "exact")],
    });
    const habits = buildPredictionHabits(corpus, "u1");
    expect(habits).toBeNull();
  });

  it("suppresses the against-crowd sentence below five against-crowd picks", () => {
    const four = buildPredictionHabits(corpusWithPicks(20, 4), "u1");
    const five = buildPredictionHabits(corpusWithPicks(20, 5), "u1");
    expect(four?.consensus.against.count).toBe(4);
    expect(four?.sentence).toBeNull();
    expect(five?.consensus.against.count).toBe(5);
    expect(five?.sentence).not.toBeNull();
  });

  it("does not invent a most-called scoreline when the top scorelines tie", () => {
    const corpus = corpusWithPicks(20);
    corpus.picks = corpus.picks.map((item, index) =>
      item.userId === "u1" && index < 20
        ? { ...item, predHome: index % 2, predAway: 1 }
        : item,
    );
    expect(buildPredictionHabits(corpus, "u1")?.mostCalled).toBeNull();
  });

  it("leaves partially void fixtures out of the settled-pick sample", () => {
    const base = corpusWithPicks(20);
    base.fixtures.push({ ...settledFixture("void-fixture", 1), state: "void", ftHome: null, ftAway: null });
    base.picks.push(pick("u1", "void-fixture", 9, 9));
    const habits = buildPredictionHabits(base, "u1");
    expect(habits?.pickCount).toBe(20);
    expect(habits?.gameweeks).toEqual([1]);
  });

  it("keeps a moved fixture's old void gameweek separate from its later settled gameweek", () => {
    const regularFixtures = Array.from({ length: 19 }, (_, index) =>
      settledFixture(`regular-${index}`, 1),
    );
    const oldMovedFixture = {
      ...settledFixture("moved-fixture", 1),
      state: "void" as const,
      ftHome: null,
      ftAway: null,
    };
    const laterMovedFixture = settledFixture("moved-fixture", 2, 2, 0);
    const regularPicks = regularFixtures.flatMap((fixture) => [
      pick("u1", fixture.fixtureId, 2, 1, 1),
      pick("u2", fixture.fixtureId, 2, 1, 1),
      pick("u3", fixture.fixtureId, 2, 1, 1),
    ]);
    const corpus = emptyCorpus({
      gameweeks: [
        { gwNumber: 1, entrantIds: ["u1", "u2", "u3"] },
        { gwNumber: 2, entrantIds: ["u1", "u2", "u3"] },
      ],
      fixtures: [oldMovedFixture, ...regularFixtures, laterMovedFixture],
      picks: [
        ...regularPicks,
        pick("u1", "moved-fixture", 0, 1, 1),
        pick("u2", "moved-fixture", 0, 1, 1),
        pick("u3", "moved-fixture", 0, 1, 1),
        pick("u1", "moved-fixture", 0, 1, 2),
        pick("u2", "moved-fixture", 2, 0, 2),
        pick("u3", "moved-fixture", 2, 0, 2),
      ],
      results: [
        ...regularFixtures.map((fixture) => result("u1", 1, fixture.fixtureId, "exact")),
        result("u1", 1, "moved-fixture", "void"),
        result("u1", 2, "moved-fixture", "exact"),
      ],
    });

    const habits = buildPredictionHabits(corpus, "u1");

    expect(habits?.pickCount).toBe(20);
    expect(habits?.gameweeks).toEqual([1, 2]);
    expect(habits?.consensus.withCrowd.count).toBe(19);
    expect(habits?.consensus.against.count).toBe(1);
    expect(habits?.consensus.against.correct).toBe(1);
  });

  it("keeps fully void and dirty gameweeks in the exclusion footnote, not the sample", () => {
    const habits = buildPredictionHabits(
      corpusWithPicks(20),
      "u1",
    );
    expect(habits?.excludedGameweeks).toEqual([]);
    const excluded = buildPredictionHabits(
      emptyCorpus({
        ...corpusWithPicks(20),
        excludedGameweeks: [
          { gwNumber: 2, reason: "void" },
          { gwNumber: 3, reason: "recalculating" },
        ],
      }),
      "u1",
    );
    expect(excluded?.gameweeks).toEqual([1]);
    expect(excluded?.excludedGameweeks).toEqual([
      { gwNumber: 2, reason: "void" },
      { gwNumber: 3, reason: "recalculating" },
    ]);
  });
});
