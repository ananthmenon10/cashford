import { describe, expect, it } from "vitest";
import { loadMatchesTab } from "../../lib/matches-tab-load";

function query(data: unknown[]) {
  const result = { data, error: null };
  return {
    select: () => query(data),
    eq: () => query(data),
    neq: () => query(data),
    in: () => query(data),
    not: () => query(data),
    gt: () => query(data),
    lte: () => query(data),
    order: () => query(data),
    then: (resolve: (value: typeof result) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
}

function sessionFor(data: Record<string, unknown[]>) {
  return {
    from(table: string) {
      return query(data[table] ?? []);
    },
  } as never;
}

describe("matches tab loader", () => {
  it("marks a CL3 gameweek provisional even when no fixture is live", async () => {
    const kickoff = "2026-02-03T15:00:00.000Z";
    const session = sessionFor({
      competitions: [
        { id: "comp", slug: "pl-2026-27", name: "Premier League", status: "active" },
      ],
      leagues: [{ id: "league", slug: "friends", name: "Friends", status: "active" }],
      league_competitions: [
        {
          league_id: "league",
          competition_id: "comp",
          status: "active",
          eligible_from_gameweek_id: "gw3",
          joined_at: "2026-01-01T00:00:00.000Z",
          competitions: {
            id: "comp",
            slug: "pl-2026-27",
            name: "Premier League",
            status: "active",
            format: "league",
          },
        },
      ],
      member_competitions: [
        {
          league_id: "league",
          competition_id: "comp",
          user_id: "viewer",
          eligible_from_gameweek_id: "gw3",
          left_at: null,
        },
      ],
      gameweeks: [
        {
          id: "gw3",
          number: 3,
          name: "GW 3",
          deadline_at: "2026-02-03T10:00:00.000Z",
          status: "open",
        },
      ],
      gameweek_contests: [
        {
          id: "contest",
          league_id: "league",
          gameweek_id: "gw3",
          stake_inr: 100,
          deadline_at: "2026-02-03T10:00:00.000Z",
          status: "locked",
          input_version: 1,
        },
      ],
      gameweek_fixtures: [
        {
          id: "membership-1",
          gameweek_id: "gw3",
          fixture_id: "fixture-1",
          state: "active",
          fixtures: {
            id: "fixture-1",
            kickoff_at: kickoff,
            status: "finished",
            status_detail: "Full Time",
            minute: null,
            ft_home: 1,
            ft_away: 0,
            home: { id: "home", name: "Arsenal", flag_url: null },
            away: { id: "away", name: "Chelsea", flag_url: null },
            fixture_insights: [],
          },
        },
        {
          id: "membership-2",
          gameweek_id: "gw3",
          fixture_id: "fixture-2",
          state: "active",
          fixtures: {
            id: "fixture-2",
            kickoff_at: "2026-02-04T15:00:00.000Z",
            status: "scheduled",
            status_detail: "Scheduled",
            minute: null,
            ft_home: null,
            ft_away: null,
            home: { id: "home-2", name: "France", flag_url: null },
            away: { id: "away-2", name: "Germany", flag_url: null },
            fixture_insights: [],
          },
        },
      ],
      gameweek_results: [],
      gameweek_entries: [],
      gameweek_entry_results: [],
    });

    const view = await loadMatchesTab(
      session,
      "viewer",
      3,
      new Date("2026-02-03T12:00:00.000Z"),
    );

    expect(view?.gw.state).toBe("live");
    expect(view?.yourGw?.provisional).toBe(true);
    expect(view?.fixtures).toHaveLength(2);
  });
});
