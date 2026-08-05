import { describe, expect, it } from "vitest";
import { groupFixturesByLocalDay, type FixtureRowView } from "./matches-tab";

function fixture(id: string, kickoffAt: string): FixtureRowView {
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
});
