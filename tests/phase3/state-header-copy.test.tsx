// Phase 3 — §5 build fix: the League Gameweek screen's "You'll predict all N scorelines" body
// copy (C4) was hardcoded to "10" everywhere. ZZ-P1 gameweeks have 5 fixtures, not 10 — C4 must
// read the gameweek's real active-fixture count, not a constant.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { StateHeader } from "../../components/gw/StateHeader";
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
});
