import { describe, expect, it } from "vitest";
import { buildWeeklyLabels, type WeeklyLabelKey } from "../../lib/analytics-labels";
import { ANALYTICS_COPY } from "../../lib/analytics-copy";
import { emptyCorpus, pick, result, settledFixture } from "../fixtures/analytics-corpus";

function label(module: ReturnType<typeof buildWeeklyLabels>, key: WeeklyLabelKey) {
  return module?.labels.find((item) => item.key === key);
}

describe("buildWeeklyLabels", () => {
  it("does not fabricate an Oracle winner when exacts tie", () => {
    const corpus = emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2", "u3"] }],
      fixtures: [settledFixture("f1", 1)],
      results: [
        result("u1", 1, "f1", "exact"),
        result("u2", 1, "f1", "exact"),
        result("u3", 1, "f1", "miss"),
      ],
    });

    const oracle = label(buildWeeklyLabels(corpus, "u1"), "oracle");

    expect(oracle).toMatchObject({
      awarded: null,
      notAwardedReason: ANALYTICS_COPY.weeklyLabelTie(ANALYTICS_COPY.weeklyLabelOracle),
    });
  });

  it("suppresses an all-zero field when nobody clears its bar", () => {
    const corpus = emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2"] }],
      fixtures: [settledFixture("f1", 1)],
    });

    const module = buildWeeklyLabels(corpus, "u1");

    expect(module?.labels).toHaveLength(4);
    for (const item of module?.labels ?? []) {
      expect(item.awarded).toBeNull();
      expect(item.notAwardedReason).toBe(
        ANALYTICS_COPY.weeklyLabelNoBar(item.name),
      );
    }
  });

  it("uses the latest included gameweek when a later one is excluded", () => {
    const corpus = emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2"] }],
      excludedGameweeks: [{ gwNumber: 2, reason: "void" }],
      fixtures: [
        settledFixture("gw1", 1),
        { ...settledFixture("gw2", 2), state: "void", ftHome: null, ftAway: null },
      ],
    });

    expect(buildWeeklyLabels(corpus, "u1")?.gwNumber).toBe(1);
  });

  it("excludes a void fixture from the count and every label metric", () => {
    const corpus = emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2", "u3"] }],
      fixtures: [
        settledFixture("counted", 1, 2, 1),
        { ...settledFixture("void", 1, 2, 1), state: "void" },
      ],
      picks: [
        pick("u1", "counted", 2, 0),
        pick("u2", "counted", 0, 1),
        pick("u3", "counted", 0, 1),
        pick("u1", "void", 2, 0),
        pick("u2", "void", 0, 1),
        pick("u3", "void", 0, 1),
      ],
      results: [
        result("u1", 1, "counted", "exact"),
        result("u2", 1, "counted", "result"),
        result("u3", 1, "counted", "result"),
        result("u1", 1, "void", "exact"),
        result("u2", 1, "void", "result"),
        result("u3", 1, "void", "result"),
      ],
    });

    const module = buildWeeklyLabels(corpus, "u1");

    expect(module?.countedFixtures).toBe(1);
    expect(label(module, "oracle")).toMatchObject({
      awarded: expect.objectContaining({ userId: "u1", value: 1, runnerUp: 0 }),
    });
    expect(label(module, "nearly")).toMatchObject({
      awarded: null,
      notAwardedReason: ANALYTICS_COPY.weeklyLabelNoBar(ANALYTICS_COPY.weeklyLabelNearly),
    });
    expect(label(module, "crowd")).toMatchObject({
      awarded: null,
      notAwardedReason: ANALYTICS_COPY.weeklyLabelTie(ANALYTICS_COPY.weeklyLabelCrowd),
    });
    expect(label(module, "maverick")).toMatchObject({
      awarded: null,
      notAwardedReason: ANALYTICS_COPY.weeklyLabelNoBar(ANALYTICS_COPY.weeklyLabelMaverick),
    });
  });

  it("scores only gameweek entrants, even when another member has picks", () => {
    const corpus = emptyCorpus({
      members: [
        { userId: "u1", name: "Ananth", isViewer: true },
        { userId: "u2", name: "Rival", isViewer: false },
        { userId: "outsider", name: "Outsider", isViewer: false },
      ],
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2"] }],
      fixtures: [settledFixture("f1", 1)],
      picks: [pick("outsider", "f1", 2, 1)],
      results: [result("outsider", 1, "f1", "exact")],
    });

    const module = buildWeeklyLabels(corpus, "u1");

    expect(module?.entrantCount).toBe(2);
    expect(module?.labels.every((item) =>
      item.awarded == null || ["u1", "u2"].includes(item.awarded.userId),
    )).toBe(true);
  });

  it("keeps the same fixture id separate across gameweeks", () => {
    const corpus = emptyCorpus({
      gameweeks: [
        { gwNumber: 1, entrantIds: ["u1", "u2"] },
        { gwNumber: 2, entrantIds: ["u1", "u2"] },
      ],
      fixtures: [
        settledFixture("moved", 1, 2, 1),
        settledFixture("moved", 2, 0, 0),
      ],
      results: [
        result("u1", 1, "moved", "exact"),
        result("u2", 1, "moved", "miss"),
        result("u1", 2, "moved", "miss"),
        result("u2", 2, "moved", "exact"),
      ],
    });

    const oracle = label(buildWeeklyLabels(corpus, "u1"), "oracle");

    expect(oracle).toMatchObject({
      awarded: expect.objectContaining({ userId: "u2", value: 1, runnerUp: 0 }),
    });
  });

  it("awards Oracle with its value, runner-up, and viewer marker", () => {
    const corpus = emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2", "u3"] }],
      fixtures: [settledFixture("f1", 1), settledFixture("f2", 1)],
      results: [
        result("u1", 1, "f1", "exact"),
        result("u1", 1, "f2", "exact"),
        result("u2", 1, "f1", "exact"),
        result("u2", 1, "f2", "result"),
        result("u3", 1, "f1", "result"),
        result("u3", 1, "f2", "result"),
      ],
    });

    expect(label(buildWeeklyLabels(corpus, "u1"), "oracle")?.awarded).toEqual({
      userId: "u1",
      name: "Ananth",
      isViewer: true,
      value: 2,
      runnerUp: 1,
    });
  });

  it("awards Nearly only at two one-goal misses", () => {
    const corpus = emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2", "u3"] }],
      fixtures: [settledFixture("f1", 1, 2, 1), settledFixture("f2", 1, 2, 1)],
      picks: [
        pick("u1", "f1", 1, 1),
        pick("u1", "f2", 0, 0),
        pick("u2", "f1", 1, 1),
        pick("u2", "f2", 1, 1),
        pick("u3", "f1", 0, 0),
        pick("u3", "f2", 0, 0),
      ],
    });

    expect(label(buildWeeklyLabels(corpus, "u1"), "nearly")?.awarded).toEqual({
      userId: "u2",
      name: "Dheeraj",
      isViewer: false,
      value: 2,
      runnerUp: 1,
    });
  });

  it("awards The Crowd from a unique modal scoreline", () => {
    const fixtures = Array.from({ length: 5 }, (_, index) => settledFixture(`f${index}`, 1));
    const corpus = emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2", "u3"] }],
      fixtures,
      picks: [
        pick("u1", "f0", 2, 1), pick("u2", "f0", 2, 1), pick("u3", "f0", 0, 0),
        pick("u1", "f1", 2, 1), pick("u2", "f1", 2, 1), pick("u3", "f1", 0, 0),
        pick("u1", "f2", 2, 1), pick("u2", "f2", 0, 0), pick("u3", "f2", 2, 1),
        pick("u1", "f3", 2, 1), pick("u2", "f3", 0, 0), pick("u3", "f3", 1, 1),
        pick("u1", "f4", 2, 1), pick("u2", "f4", 0, 0), pick("u3", "f4", 1, 0),
      ],
    });

    expect(label(buildWeeklyLabels(corpus, "u1"), "crowd")?.awarded).toEqual({
      userId: "u1",
      name: "Ananth",
      isViewer: true,
      value: 3,
      runnerUp: 2,
    });
  });

  it("awards Maverick for correct calls against the modal outcome", () => {
    const corpus = emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2", "u3"] }],
      fixtures: [settledFixture("f1", 1, 2, 1), settledFixture("f2", 1, 2, 1)],
      picks: [
        pick("u1", "f1", 2, 1), pick("u2", "f1", 0, 1), pick("u3", "f1", 0, 1),
        pick("u1", "f2", 2, 1), pick("u2", "f2", 0, 1), pick("u3", "f2", 0, 1),
      ],
      results: [
        result("u1", 1, "f1", "exact"),
        result("u1", 1, "f2", "result"),
      ],
    });

    expect(label(buildWeeklyLabels(corpus, "u1"), "maverick")?.awarded).toEqual({
      userId: "u1",
      name: "Ananth",
      isViewer: true,
      value: 2,
      runnerUp: 0,
    });
  });

  it("returns null without an included gameweek, enough entrants, or counted fixtures", () => {
    expect(buildWeeklyLabels(emptyCorpus(), "u1")).toBeNull();
    expect(buildWeeklyLabels(emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1"] }],
      fixtures: [settledFixture("f1", 1)],
    }), "u1")).toBeNull();
    expect(buildWeeklyLabels(emptyCorpus({
      gameweeks: [{ gwNumber: 1, entrantIds: ["u1", "u2"] }],
      fixtures: [{ ...settledFixture("f1", 1), state: "void" }],
    }), "u1")).toBeNull();
  });
});
