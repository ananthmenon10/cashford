import { describe, expect, it } from "vitest";
import {
  groupFixturesByLocalDay,
  isLiveFixtureState,
  liveClubMinutes,
  liveMinuteFromState,
  type FixtureRowView,
} from "./matches-tab";

function fixture(
  id: string,
  kickoffAt: string,
  overrides: Partial<FixtureRowView> = {},
): FixtureRowView {
  return {
    id,
    state: "",
    scheduled: true,
    kickoffAt,
    home: { name: "Home" },
    away: { name: "Away" },
    score: null,
    matchHref: `/m/${id}`,
    insightsMark: false,
    yourCall: { kind: "none" },
    ...overrides,
  };
}

describe("groupFixturesByLocalDay", () => {
  it("keeps late-night UTC fixtures on the same local India day", () => {
    const groups = groupFixturesByLocalDay(
      [
        fixture("late", "2026-08-17T18:45:00.000Z"),
        fixture("after-midnight-utc", "2026-08-17T23:30:00.000Z"),
      ],
      "Asia/Kolkata",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].dayKey).toBe("2026-08-18");
    expect(groups[0].fixtures.map((row) => row.id)).toEqual([
      "late",
      "after-midnight-utc",
    ]);
  });

  it("drops no fixtures across any number of days — a truncation cap must never come back", () => {
    const rows = Array.from({ length: 23 }, (_, i) =>
      fixture(`f${i}`, `2026-08-${10 + (i % 14)}T12:00:00.000Z`),
    );

    const groups = groupFixturesByLocalDay(rows, "Asia/Kolkata");
    const total = groups.reduce((sum, day) => sum + day.fixtures.length, 0);

    expect(total).toBe(rows.length);
    expect(groups.length).toBeGreaterThan(7);
  });
});

describe("isLiveFixtureState", () => {
  it("is true only for the LIVE label shape matches-tab-load produces", () => {
    expect(isLiveFixtureState("63' · LIVE")).toBe(true);
    expect(isLiveFixtureState("' · LIVE")).toBe(true);
    expect(isLiveFixtureState("Full time")).toBe(false);
    expect(isLiveFixtureState("Postponed")).toBe(false);
    expect(isLiveFixtureState("")).toBe(false);
  });
});

describe("liveMinuteFromState", () => {
  it("reads the leading minute off a live label", () => {
    expect(liveMinuteFromState("63' · LIVE")).toBe(63);
  });

  it("returns null when the minute is unknown", () => {
    expect(liveMinuteFromState("' · LIVE")).toBeNull();
    expect(liveMinuteFromState("Full time")).toBeNull();
  });
});

describe("liveClubMinutes", () => {
  it("maps both clubs of a live fixture to its minute, and leaves non-live clubs out", () => {
    const rows = [
      fixture("f1", "2026-08-10T12:00:00.000Z", {
        state: "63' · LIVE",
        home: { name: "Arsenal" },
        away: { name: "Chelsea" },
      }),
      fixture("f2", "2026-08-10T14:00:00.000Z", {
        state: "Full time",
        home: { name: "Everton" },
        away: { name: "Fulham" },
      }),
    ];

    const minutes = liveClubMinutes(rows);

    expect(minutes.get("Arsenal")).toBe(63);
    expect(minutes.get("Chelsea")).toBe(63);
    expect(minutes.has("Everton")).toBe(false);
    expect(minutes.has("Fulham")).toBe(false);
  });

  it("maps a minute-unknown live fixture's clubs to null, not a missing entry", () => {
    const rows = [
      fixture("f1", "2026-08-10T12:00:00.000Z", {
        state: "' · LIVE",
        home: { name: "Arsenal" },
        away: { name: "Chelsea" },
      }),
    ];

    const minutes = liveClubMinutes(rows);

    expect(minutes.get("Arsenal")).toBeNull();
    expect(minutes.has("Arsenal")).toBe(true);
  });
});
