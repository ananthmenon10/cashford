// Step 6B — proves the two locked canon decisions hold at the component layer, not just in the
// pure helpers: fixture list B renders every fixture with zero truncation (no "…N more" summary
// row can come back undetected), and table A renders all 20 rows with the live club highlighted.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { Phase4MatchesPage } from "../../components/Phase4MatchesPage";
import type { FixtureRowView, MatchesTabView } from "../../lib/matches-tab";
import type { StandingsView, StandingsViewRow } from "../../lib/standings-view";

afterEach(() => cleanup());

function fixture(
  id: string,
  kickoffAt: string,
  overrides: Partial<FixtureRowView> = {},
): FixtureRowView {
  return {
    id,
    state: "Full time",
    scheduled: false,
    kickoffAt,
    home: { name: `Home ${id}` },
    away: { name: `Away ${id}` },
    score: [1, 0],
    matchHref: `/m/${id}`,
    insightsMark: false,
    yourCall: { kind: "none" },
    ...overrides,
  };
}

function view(fixtures: FixtureRowView[]): MatchesTabView {
  return {
    competition: { id: "c1", slug: "pl-2026-27", name: "Premier League", archived: false },
    scopes: [{ slug: "pl-2026-27", name: "Premier League" }],
    selectedScope: "pl-2026-27",
    gw: {
      id: "gw1",
      number: 1,
      label: "Gameweek 1",
      state: "live",
      deadlineAt: "2026-08-10T12:00:00.000Z",
      isCurrent: true,
    },
    picker: { range: [1], futureCaveat: false },
    yourGw: null,
    winnersRecap: null,
    fixtures,
  };
}

function standingsRow(rank: number, club: string): StandingsViewRow {
  return {
    rank,
    club,
    club_id: `club-${rank}`,
    played: 5,
    won: 3,
    drawn: 1,
    lost: 1,
    gd: 4,
    points: 10,
    form: ["W", "W", "D", "L", "W"],
  };
}

function standings(rows: StandingsViewRow[]): StandingsView {
  return {
    sourceLine: "ESPN · updated 2m ago",
    rows,
    championsLeagueAfterRank: 4,
    relegationFromRank: rows.length - 2,
    note: null,
  };
}

describe("Phase4MatchesPage — fixture list completeness", () => {
  it("renders every fixture across many days with no truncation, and lets a day collapse", () => {
    // 9 fixtures spread across 9 distinct local days — enough to have overflowed the old
    // limitDays(days, 7) cap were it still present.
    const fixtures = Array.from({ length: 9 }, (_, i) =>
      fixture(`f${i}`, `2026-08-${10 + i}T12:00:00.000Z`),
    );

    render(
      <Phase4MatchesPage view={view(fixtures)} standings={null} segment="fixtures" />,
    );

    for (const f of fixtures) {
      expect(screen.getByText(f.home.name)).toBeInTheDocument();
    }
    // No leftover "more" overflow copy of any kind.
    expect(screen.queryByText(/more/i)).not.toBeInTheDocument();

    const toggles = screen.getAllByRole("button", { name: /collapse/i });
    expect(toggles.length).toBeGreaterThanOrEqual(9);
    fireEvent.click(toggles[0]);
    expect(screen.getAllByRole("button", { name: /expand/i }).length).toBe(1);
    // The fixture inside the now-collapsed day is gone from the DOM…
    expect(screen.queryByText(fixtures[0].home.name)).not.toBeInTheDocument();
    // …but every other fixture is untouched.
    for (const f of fixtures.slice(1)) {
      expect(screen.getByText(f.home.name)).toBeInTheDocument();
    }
  });

  it("shows a live badge for an in-play fixture instead of its kickoff time", () => {
    const live = fixture("live1", "2026-08-10T12:00:00.000Z", {
      state: "63' · LIVE",
      score: null,
    });
    render(
      <Phase4MatchesPage view={view([live])} standings={null} segment="fixtures" />,
    );
    expect(screen.getByText("LIVE 63′")).toBeInTheDocument();
  });
});

describe("Phase4MatchesPage — table A completeness", () => {
  it("renders all 20 rows with no top-N cap", () => {
    const rows = Array.from({ length: 20 }, (_, i) => standingsRow(i + 1, `Club ${i + 1}`));
    render(
      <Phase4MatchesPage
        view={view([])}
        standings={standings(rows)}
        segment="table"
      />,
    );
    for (const row of rows) {
      expect(screen.getByText(row.club)).toBeInTheDocument();
    }
    expect(screen.getByText("20 rows")).toBeInTheDocument();
  });

  it("highlights a club playing right now with a live badge", () => {
    const rows = [standingsRow(1, "Arsenal"), standingsRow(2, "Chelsea")];
    const liveFixture = fixture("f1", "2026-08-10T12:00:00.000Z", {
      state: "12' · LIVE",
      home: { name: "Arsenal" },
      away: { name: "Everton" },
      score: null,
    });
    render(
      <Phase4MatchesPage
        view={view([liveFixture])}
        standings={standings(rows)}
        segment="table"
      />,
    );
    expect(screen.getByText("LIVE 12′")).toBeInTheDocument();
  });

  it("renders the live badge inside the club's own cell, not the sticky rank/Pos slot", () => {
    // Regression guard for must-fixes 2/3: with the club (not Pos) as the sticky column, the LIVE
    // badge (injected into the first cell by TableStandard) must land in the same <td> as the club
    // name — never clipped into a bare rank column.
    const rows = [standingsRow(1, "Arsenal"), standingsRow(2, "Chelsea")];
    const liveFixture = fixture("f1", "2026-08-10T12:00:00.000Z", {
      state: "12' · LIVE",
      home: { name: "Arsenal" },
      away: { name: "Everton" },
      score: null,
    });
    render(
      <Phase4MatchesPage
        view={view([liveFixture])}
        standings={standings(rows)}
        segment="table"
      />,
    );
    const clubName = screen.getByText("Arsenal");
    const badge = screen.getByText("LIVE 12′");
    const clubCell = clubName.closest('[role="cell"]');
    expect(clubCell).not.toBeNull();
    expect(clubCell).toContainElement(badge);
  });
});

describe("Phase4MatchesPage — fixture day order", () => {
  it("renders day headers in chronological order with the correct date label", () => {
    const fixtures = [
      fixture("later", "2026-08-15T12:00:00.000Z"),
      fixture("earlier", "2026-08-10T12:00:00.000Z"),
      fixture("middle", "2026-08-12T12:00:00.000Z"),
    ];
    render(
      <Phase4MatchesPage view={view(fixtures)} standings={null} segment="fixtures" />,
    );
    const headers = screen.getAllByRole("button", { name: /collapse/i });
    // Three distinct local days, in chronological order — not fixture-array order.
    expect(headers).toHaveLength(3);
    expect(headers[0].textContent).toMatch(/10/);
    expect(headers[1].textContent).toMatch(/12/);
    expect(headers[2].textContent).toMatch(/15/);
  });
});
