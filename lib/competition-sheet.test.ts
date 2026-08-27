import { describe, expect, it } from "vitest";
import { buildCompetitionSheet } from "./competition-sheet";

describe("buildCompetitionSheet", () => {
  it("puts archived competitions last while retaining date/slug order within each group", () => {
    const sheet = buildCompetitionSheet("kk-bois", [
      {
        competitionId: "wc-2022",
        slug: "wc2022",
        name: "World Cup 2022",
        format: "cup",
        participationStatus: "archived",
        joinedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        competitionId: "pl",
        slug: "pl-2026-27",
        name: "Premier League 2026-27",
        format: "gameweek",
        participationStatus: "active",
        joinedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        competitionId: "wc-2026",
        slug: "wc2026",
        name: "World Cup 2026",
        format: "cup",
        participationStatus: "archived",
        joinedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        competitionId: "la-liga",
        slug: "la-liga-2026-27",
        name: "LaLiga 2026-27",
        format: "gameweek",
        participationStatus: "active",
        joinedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        competitionId: "active-zeta",
        slug: "zeta",
        name: "Zeta",
        format: "league",
        participationStatus: "active",
        joinedAt: "2026-08-02T00:00:00.000Z",
      },
      {
        competitionId: "active-alpha",
        slug: "alpha",
        name: "Alpha",
        format: "league",
        participationStatus: "active",
        joinedAt: "2026-08-02T00:00:00.000Z",
      },
      {
        competitionId: "archived-zeta",
        slug: "archived-zeta",
        name: "Archived Zeta",
        format: "cup",
        participationStatus: "archived",
        joinedAt: "2026-07-02T00:00:00.000Z",
      },
      {
        competitionId: "archived-alpha",
        slug: "archived-alpha",
        name: "Archived Alpha",
        format: "cup",
        participationStatus: "archived",
        joinedAt: "2026-07-02T00:00:00.000Z",
      },
    ]);

    expect(sheet.items.map((item) => item.competitionId)).toEqual([
      "active-alpha",
      "active-zeta",
      "la-liga",
      "pl",
      "archived-alpha",
      "archived-zeta",
      "wc-2026",
      "wc-2022",
    ]);
  });
});
