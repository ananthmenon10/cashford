import { describe, expect, it } from "vitest";
import { matchFixture } from "../../lib/provider-match";

const fixture = {
  kickoffAt: "2026-02-03T15:00:00.000Z",
  homeName: "Arsenal",
  awayName: "Chelsea",
};

describe("provider match", () => {
  it("A-13: an exact-name candidate on the same day matches with confidence 'exact'", () => {
    expect(
      matchFixture(fixture, [
        {
          id: "c1",
          date: "2026-02-03T20:00:00.000Z",
          homeName: "Arsenal",
          awayName: "Chelsea",
        },
      ]),
    ).toMatchObject({ externalId: "c1", confidence: "exact" });
  });

  it("A-14: an aliased-name candidate (normalizeClubName) matches with confidence 'matched'", () => {
    expect(
      matchFixture(fixture, [
        {
          id: "c1",
          date: "2026-02-03T20:00:00.000Z",
          homeName: "Arsenal FC",
          awayName: "Chelsea FC",
        },
      ]),
    ).toMatchObject({ externalId: "c1", confidence: "matched" });
  });

  it("rejects one-club, wrong-date, and ambiguous matches", () => {
    const correct = {
      id: "c1",
      date: "2026-02-03T15:00:00.000Z",
      homeName: "Arsenal",
      awayName: "Chelsea",
    };
    expect(
      matchFixture(fixture, [{ ...correct, awayName: "Fulham" }]),
    ).toBeNull();
    expect(
      matchFixture(fixture, [{ ...correct, date: "2026-02-04" }]),
    ).toBeNull();
    expect(matchFixture(fixture, [correct, { ...correct, id: "c2" }])).toBeNull();
  });
});
