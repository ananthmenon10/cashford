// Phase 3 — §5 build fix: the League Gameweek screen's "You'll predict all N scorelines" body
// copy (C4) was hardcoded to "10" everywhere. ZZ-P1 gameweeks have 5 fixtures, not 10 — C4 must
// read the gameweek's real active-fixture count, not a constant.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { StateHeader } from "../../components/gw/StateHeader";
import { LeagueGameweekPane } from "../../components/gw/LeaguePanes";
import type { GameweekViewDTO } from "../../lib/gw-view";

afterEach(() => cleanup());

function fixture(id: string, overrides: Partial<GameweekViewDTO["fixtures"][number]> = {}) {
  return {
    fixtureId: id,
    membershipId: `m-${id}`,
    state: "active" as const,
    voidReason: null,
    kickoffAt: "2026-02-03T10:30:00.000Z",
    status: "scheduled",
    minute: null,
    homeScore: null,
    awayScore: null,
    homeName: `Home ${id}`,
    awayName: `Away ${id}`,
    homeShort: "HOM",
    awayShort: "AWY",
    ...overrides,
  };
}

function view(overrides: Partial<GameweekViewDTO> = {}): GameweekViewDTO {
  return {
    league: { id: "l1", name: "KK Bois", slug: "kk-bois", createdBy: "u1", status: "active" },
    participation: { format: "gameweek" } as GameweekViewDTO["participation"],
    competition: { id: "c1", name: "Premier League", format: "league" },
    gameweek: { id: "gw24", number: 24, name: "Gameweek 24", status: "open", deadlineAt: "2026-02-03T10:30:00.000Z" },
    hasSettledHistory: false,
    gameweekAccess: { now: null, last: null },
    adjacentGameweeks: [],
    contest: { id: "contest1", status: "open", stakeInr: 100, deadlineAt: "2026-02-03T10:30:00.000Z", inputVersion: 1 },
    lifecycle: "CL1" as GameweekViewDTO["lifecycle"],
    viewerParticipation: "VP1" as GameweekViewDTO["viewerParticipation"],
    render: {} as GameweekViewDTO["render"],
    fixtures: [],
    viewerEntry: null,
    viewerPicks: [],
    revealedPicks: [],
    standings: [],
    result: null,
    enteredCount: 0,
    eligibleCount: 6,
    potInr: 0,
    isDoubleGameweek: false,
    viewerEligibleFromGameweekNumber: 1,
    nudge: null,
    ...overrides,
  };
}

function pointGrid(): NonNullable<GameweekViewDTO["pointGrid"]> {
  return {
    leagueId: "l1",
    leagueName: "KK Bois",
    gameweekNumber: 24,
    viewerId: "u1",
    entrants: [{
      entryId: "entry1",
      userId: "u1",
      name: "Ananth Menon",
      initials: "AM",
      isViewer: true,
      totalPoints: 0,
    }],
    rows: [{
      fixture: {
        fixtureId: "f1",
        homeName: "Home f1",
        awayName: "Away f1",
        kickoffAt: "2026-02-03T10:30:00.000Z",
        status: "scheduled",
        minute: null,
        homeScore: null,
        awayScore: null,
        state: "void",
        matchHref: "/m/f1",
      },
      cells: [{ pick: [2, 1], points: 0, verdict: "void" }],
    }],
  };
}

describe("StateHeader body copy (C4) sources the real per-gameweek fixture count", () => {
  it("a 5-fixture gameweek (ZZ-P1 shape) reads 'all 5 scorelines', not a hardcoded 10", () => {
    render(
      <StateHeader
        view={view({
          fixtures: [fixture("f1"), fixture("f2"), fixture("f3"), fixture("f4"), fixture("f5")],
        })}
      />,
    );
    expect(screen.getByText("You’ll predict all 5 scorelines. You can edit until the deadline.")).toBeTruthy();
    expect(screen.queryByText(/all 10 scorelines/)).toBeNull();
  });

  it("a 10-fixture gameweek still reads 'all 10 scorelines' — the count tracks the real total either way", () => {
    render(
      <StateHeader
        view={view({
          fixtures: Array.from({ length: 10 }, (_, i) => fixture(`f${i}`)),
        })}
      />,
    );
    expect(screen.getByText("You’ll predict all 10 scorelines. You can edit until the deadline.")).toBeTruthy();
  });

  it("non-active (void/withdrawn) fixtures don't count toward the total the viewer actually predicts", () => {
    render(
      <StateHeader
        view={view({
          fixtures: [
            fixture("f1"),
            fixture("f2"),
            fixture("f3", { state: "void", voidReason: "match_abandoned" }),
          ],
        })}
      />,
    );
    expect(screen.getByText("You’ll predict all 2 scorelines. You can edit until the deadline.")).toBeTruthy();
  });

  it("keeps the CL7 void note when the point grid is shown beside it", () => {
    render(
      <LeagueGameweekPane
        view={view({
          lifecycle: "CL7",
          viewerParticipation: "VP4",
          contest: { id: "contest1", status: "void", stakeInr: 100, deadlineAt: "2026-02-03T10:30:00.000Z", inputVersion: 1 },
          result: {
            outcome: "void",
            voidReason: "single_entrant",
            tiebreakUsed: null,
            settledVersion: 1,
            lastSettleCause: "initial",
          },
          pointGrid: pointGrid(),
        })}
      />,
    );

    expect(screen.getByText("Only one person entered, so the ante went back.")).toBeInTheDocument();
    expect(screen.getByTestId("point-grid-cell-void")).toBeInTheDocument();
  });

  it("shows a CL10 grid of void cells instead of the blank matches state", () => {
    render(
      <LeagueGameweekPane
        view={view({
          lifecycle: "CL10",
          viewerParticipation: "VP4",
          contest: { id: "contest1", status: "locked", stakeInr: 100, deadlineAt: "2026-02-03T10:30:00.000Z", inputVersion: 1 },
          fixtures: [fixture("f1", { state: "void", voidReason: "all_fixtures_void" })],
          pointGrid: pointGrid(),
        })}
      />,
    );

    expect(screen.getByTestId("point-grid")).toBeInTheDocument();
    expect(screen.getByTestId("point-grid-cell-void")).toBeInTheDocument();
    expect(screen.queryByText("No locked entries yet.")).not.toBeInTheDocument();
  });
});
