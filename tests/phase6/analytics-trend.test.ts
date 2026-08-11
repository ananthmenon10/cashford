import { describe, expect, it } from "vitest";
import { buildMyFormTrend } from "../../lib/analytics-feed";
import type { SeasonRow } from "../../lib/gw-season";

function row(overrides: Partial<SeasonRow> = {}): SeasonRow {
  const gwNumber = overrides.gwNumber ?? 1;
  return {
    gwNumber,
    status: "settled",
    entryStatus: "locked_in",
    points: 6,
    exacts: 2,
    countedFixtures: 6,
    correctPicks: 2,
    incorrectPicks: 4,
    voidPicks: 0,
    netInr: gwNumber * 100,
    inputVersion: 1,
    settledVersion: 1,
    isVoid: false,
    outcome: "settled",
    viewerId: "u1",
    href: `?gw=${gwNumber}`,
    dirty: false,
    displayNetInr: gwNumber * 100,
    ...overrides,
  };
}

describe("buildMyFormTrend", () => {
  it("uses six clean settled gameweeks as ascending points with real feet and range", () => {
    const trend = buildMyFormTrend(
      [1, 2, 3, 4, 5, 6].map((gwNumber) =>
        row({ gwNumber, points: gwNumber * 2, countedFixtures: 4 }),
      ),
    );

    expect(trend?.points).toEqual(
      [1, 2, 3, 4, 5, 6].map((gwNumber) => ({
        gwNumber,
        ptsPerFixture: Math.round((gwNumber / 2) * 100) / 100,
      })),
    );
    expect(trend?.bars.map((bar) => bar.gwNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(trend?.rangeLabel).toBe("GW1–GW6");
    expect(trend?.startedAt).toBeNull();
  });

  it("keeps the last six usable gameweeks rather than the first six", () => {
    const trend = buildMyFormTrend(
      [1, 2, 3, 4, 5, 6, 7, 8].map((gwNumber) => row({ gwNumber })),
    );

    expect(trend?.points.map((point) => point.gwNumber)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(trend?.bars.map((bar) => bar.gwNumber)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(trend?.rangeLabel).toBe("GW3–GW8");
  });

  it("returns null for one usable gameweek and a trend for two", () => {
    expect(buildMyFormTrend([row({ gwNumber: 1 })])).toBeNull();
    expect(buildMyFormTrend([row({ gwNumber: 1 }), row({ gwNumber: 2 })])).not.toBeNull();
  });

  it("excludes a fully-void gameweek without fabricating a zero point or bar", () => {
    const trend = buildMyFormTrend([
      row({ gwNumber: 1 }),
      row({
        gwNumber: 2,
        outcome: "void",
        isVoid: true,
        points: null,
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
        displayNetInr: 0,
      }),
      row({ gwNumber: 3 }),
    ]);

    expect(trend?.points.map((point) => point.gwNumber)).toEqual([1, 3]);
    expect(trend?.bars.map((bar) => bar.gwNumber)).toEqual([1, 3]);
    expect(trend?.points.some((point) => point.ptsPerFixture === 0)).toBe(false);
    expect(trend?.excluded).toContainEqual({ gwNumber: 2, reason: "void" });
  });

  it("excludes a gameweek the viewer did not enter without adding a zero", () => {
    const trend = buildMyFormTrend([
      row({ gwNumber: 1 }),
      row({
        gwNumber: 2,
        entryStatus: null,
        points: null,
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
        displayNetInr: 0,
      }),
      row({ gwNumber: 3 }),
    ]);

    expect(trend?.points.map((point) => point.gwNumber)).toEqual([1, 3]);
    expect(trend?.points.some((point) => point.ptsPerFixture === 0)).toBe(false);
    expect(trend?.excluded).toContainEqual({ gwNumber: 2, reason: "not_entered" });
  });

  it("uses no_counted_fixtures for zero, empty, and all-void settled snapshots", () => {
    const trend = buildMyFormTrend([
      row({ gwNumber: 1 }),
      row({ gwNumber: 2, countedFixtures: 0, points: 0 }),
      row({ gwNumber: 3, countedFixtures: 0, points: 0, per_fixture: [] }),
      row({
        gwNumber: 4,
        countedFixtures: 0,
        points: 0,
        per_fixture: [{ verdict: "void" }],
      }),
      row({ gwNumber: 5 }),
    ]);

    expect(trend?.points.map((point) => point.gwNumber)).toEqual([1, 5]);
    expect(trend?.excluded).toEqual([
      { gwNumber: 2, reason: "no_counted_fixtures" },
      { gwNumber: 3, reason: "no_counted_fixtures" },
      { gwNumber: 4, reason: "no_counted_fixtures" },
    ]);
    expect(trend?.points.some((point) => Number.isNaN(point.ptsPerFixture))).toBe(false);
  });

  it("drops a dirty gameweek from both the line and bars while keeping netDelta numeric", () => {
    const trend = buildMyFormTrend([
      row({ gwNumber: 1, netInr: 100, displayNetInr: 100 }),
      row({
        gwNumber: 2,
        points: 999,
        countedFixtures: 10,
        dirty: true,
        displayNetInr: "suppressed",
      }),
      row({ gwNumber: 3, netInr: 300, displayNetInr: 300 }),
    ]);

    expect(trend?.points.map((point) => point.gwNumber)).toEqual([1, 3]);
    expect(trend?.bars.map((bar) => bar.gwNumber)).toEqual([1, 3]);
    expect(trend?.points.some((point) => point.gwNumber === 2)).toBe(false);
    expect(trend?.netDelta).toBe(400);
    expect(trend?.excluded).toContainEqual({ gwNumber: 2, reason: "recalculating" });
  });

  it("sums only the gameweeks before the trend window for startedAt", () => {
    const trend = buildMyFormTrend([
      ...[1, 2, 3, 4, 5, 6, 7].map((gwNumber) =>
        row({ gwNumber, netInr: gwNumber * 100, displayNetInr: gwNumber * 100 }),
      ),
    ]);

    expect(trend?.points.map((point) => point.gwNumber)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(trend?.startedAt).toBe(100);
    expect(trend?.netDelta).toBe(2700);
  });

  it("sets startedAt to null when a dirty pre-window gameweek suppresses its money", () => {
    const trend = buildMyFormTrend([
      row({ gwNumber: 1, netInr: 100, displayNetInr: 100 }),
      row({ gwNumber: 2, netInr: 200, displayNetInr: 200 }),
      row({
        gwNumber: 3,
        points: 999,
        countedFixtures: 10,
        dirty: true,
        displayNetInr: "suppressed",
      }),
      ...[4, 5, 6, 7, 8, 9].map((gwNumber) => row({ gwNumber })),
    ]);

    expect(trend?.points.map((point) => point.gwNumber)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(trend?.startedAt).toBeNull();
    expect(trend?.startedAt).not.toBe(0);
    expect(trend?.startedAt).not.toBeNaN();
    expect(trend?.netDelta).toBe(3900);
  });

  it("keeps startedAt numeric when a pre-window gameweek was not entered", () => {
    const trend = buildMyFormTrend([
      row({
        gwNumber: 1,
        entryStatus: null,
        points: null,
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
        netInr: 0,
        displayNetInr: 0,
      }),
      row({ gwNumber: 2, netInr: 200, displayNetInr: 200 }),
      ...[3, 4, 5, 6, 7, 8].map((gwNumber) => row({ gwNumber })),
    ]);

    expect(trend?.points.map((point) => point.gwNumber)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(trend?.startedAt).toBe(200);
    expect(typeof trend?.startedAt).toBe("number");
  });

  it("sets startedAt to null when every pre-window gameweek was sat out", () => {
    const trend = buildMyFormTrend([
      row({
        gwNumber: 1,
        entryStatus: null,
        points: null,
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
        netInr: 0,
        displayNetInr: 0,
      }),
      row({
        gwNumber: 2,
        entryStatus: null,
        points: null,
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
        netInr: 0,
        displayNetInr: 0,
      }),
      row({ gwNumber: 3 }),
      row({ gwNumber: 4 }),
    ]);

    expect(trend?.points.map((point) => point.gwNumber)).toEqual([3, 4]);
    expect(trend?.startedAt).toBeNull();
    expect(trend?.startedAt).not.toBe(0);
  });

  it("keeps a flat run finite and pins all points to the same vertical value", () => {
    const trend = buildMyFormTrend([
      row({ gwNumber: 1, points: 4, countedFixtures: 2 }),
      row({ gwNumber: 2, points: 4, countedFixtures: 2 }),
    ]);

    expect(trend?.points.map((point) => point.ptsPerFixture)).toEqual([2, 2]);
    expect(trend?.points.every((point) => Number.isFinite(point.ptsPerFixture))).toBe(true);
  });

  it("sorts shuffled input rows before choosing the window", () => {
    const sorted = buildMyFormTrend([1, 2, 3, 4].map((gwNumber) => row({ gwNumber })));
    const shuffled = buildMyFormTrend([3, 1, 4, 2].map((gwNumber) => row({ gwNumber })));

    expect(shuffled).toEqual(sorted);
  });

  it("returns null for empty input", () => {
    expect(buildMyFormTrend([])).toBeNull();
  });

  it("records exclusions in gameweek order with distinct reasons", () => {
    const trend = buildMyFormTrend([
      row({
        gwNumber: 4,
        entryStatus: null,
        points: null,
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
        displayNetInr: 0,
      }),
      row({
        gwNumber: 2,
        outcome: "void",
        isVoid: true,
        points: null,
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
        displayNetInr: 0,
      }),
      row({
        gwNumber: 3,
        dirty: true,
        displayNetInr: "suppressed",
      }),
      row({ gwNumber: 5 }),
      row({ gwNumber: 6 }),
    ]);

    expect(trend?.excluded).toEqual([
      { gwNumber: 2, reason: "void" },
      { gwNumber: 3, reason: "recalculating" },
      { gwNumber: 4, reason: "not_entered" },
    ]);
  });

  it("drops an open gameweek without adding a point, bar, or exclusion", () => {
    const trend = buildMyFormTrend([
      row({ gwNumber: 1 }),
      row({
        gwNumber: 2,
        outcome: null,
        entryStatus: "open",
        points: null,
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
        displayNetInr: 0,
      }),
      row({ gwNumber: 3 }),
    ]);

    expect(trend?.points.map((point) => point.gwNumber)).toEqual([1, 3]);
    expect(trend?.bars.map((bar) => bar.gwNumber)).toEqual([1, 3]);
    expect(trend?.excluded).toEqual([]);
  });

  it("builds a full ZZ-P1-style trend from three settled+entered gameweeks with a trailing open gameweek", () => {
    const trend = buildMyFormTrend([
      row({ gwNumber: 1, points: 15, countedFixtures: 5, netInr: 100, displayNetInr: 100 }),
      row({ gwNumber: 2, points: 5, countedFixtures: 5, netInr: 200, displayNetInr: 200 }),
      row({ gwNumber: 3, points: 3, countedFixtures: 5, netInr: 300, displayNetInr: 300 }),
      row({
        gwNumber: 4,
        status: "open",
        entryStatus: null,
        outcome: null,
        points: null,
        countedFixtures: null,
        correctPicks: null,
        incorrectPicks: null,
        voidPicks: null,
        netInr: 0,
        displayNetInr: 0,
      }),
    ]);

    expect(trend?.points).toEqual([
      { gwNumber: 1, ptsPerFixture: 3 },
      { gwNumber: 2, ptsPerFixture: 1 },
      { gwNumber: 3, ptsPerFixture: 0.6 },
    ]);
    expect(trend?.rangeLabel).toBe("GW1–GW3");
    expect(trend?.excluded).toEqual([]);
    expect(trend?.startedAt).toBeNull();
    expect(typeof trend?.netDelta).toBe("number");
    expect(trend?.netDelta).toBe(600);
  });
});
