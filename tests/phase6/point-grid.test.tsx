import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PointGrid } from "../../components/matches/PointGrid";
import type {
  PointGridCell,
  PointGridView,
} from "../../lib/point-grid";
import { MATCH_COPY } from "../../lib/match-copy";

afterEach(() => cleanup());

function cell(
  pick: [number, number],
  verdict: PointGridCell["verdict"],
  points: PointGridCell["points"],
): PointGridCell {
  return { pick, verdict, points };
}

function grid(entrantCount: number): PointGridView {
  const entrants = Array.from({ length: entrantCount }, (_, index) => ({
    entryId: `entry-${index + 1}`,
    userId: `user-${index + 1}`,
    name: `Player ${index + 1}`,
    initials: `P${index + 1}`,
    isViewer: index === Math.min(2, entrantCount - 1),
    totalPoints: index === 0 ? 3 : 1,
  }));
  return {
    leagueId: "league-1",
    leagueName: "Friends",
    gameweekNumber: 3,
    viewerId: "user-3",
    entrants,
    rows: [{
      fixture: {
        fixtureId: "fixture-1",
        homeName: "Arsenal",
        awayName: "Everton",
        kickoffAt: "2026-08-15T15:00:00.000Z",
        status: "finished",
        minute: null,
        homeScore: 2,
        awayScore: 0,
        state: "active",
        matchHref: "/m/fixture-1",
      },
      cells: entrants.map((_, index) => cell(
        [index, 0],
        index === 0 ? "exact" : index === 1 ? "result" : index === 2 ? "miss" : "void",
        index === 0 ? 3 : index === 1 ? 1 : 0,
      )),
    }],
  };
}

describe("PointGrid", () => {
  it("shows the fixture block, picks, points, and verdict colours without leader treatment", () => {
    render(<PointGrid grid={grid(4)} />);

    expect(screen.getByText("Arsenal")).toBeInTheDocument();
    expect(screen.getByText("Everton")).toBeInTheDocument();
    expect(screen.getAllByText("+3")).toHaveLength(1);
    expect(screen.getAllByText("+1")).toHaveLength(1);
    expect(screen.getByTestId("point-grid-cell-exact")).toHaveClass("text-cs2-green");
    expect(screen.getByTestId("point-grid-cell-result")).toHaveClass("text-cs2-amber");
    expect(screen.getByTestId("point-grid-cell-miss")).toHaveClass("text-cs2-red");
    expect(screen.getByTestId("point-grid-cell-void")).toHaveClass("text-cs2-ink-3");
    expect(screen.queryByText(/Lead/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("point-grid-leader-cell")).not.toBeInTheDocument();
  });

  it("keeps an opaque paper base under the exact verdict tint on the pinned viewer cell", () => {
    const view = grid(5);
    view.rows[0]!.cells[2] = cell([2, 0], "exact", 3);
    render(<PointGrid grid={view} />);

    const viewerCell = screen.getByTestId("point-grid-viewer-cell").parentElement!;
    const nonPinnedExactCell = screen
      .getAllByTestId("point-grid-cell-exact")
      .find((candidate) => candidate !== viewerCell)!;
    expect(viewerCell).toHaveClass("bg-cs2-paper");
    expect(viewerCell).toHaveClass("before:bg-cs2-green-soft");
    expect(nonPinnedExactCell).not.toHaveClass("bg-cs2-paper");
  });

  it("fits four entrants without horizontal scrolling", () => {
    render(<PointGrid grid={grid(4)} />);

    const scroll = screen.getByTestId("point-grid-scroll");
    expect(scroll).toHaveAttribute("data-scrollable", "false");
    expect(screen.queryByTestId("point-grid-edge-cue")).not.toBeInTheDocument();
  });

  it("scrolls five entrants while pinning the fixture block and viewer column", () => {
    render(<PointGrid grid={grid(5)} />);

    expect(screen.getByTestId("point-grid-scroll")).toHaveAttribute("data-scrollable", "true");
    expect(screen.getByTestId("point-grid-edge-cue")).toBeInTheDocument();
    expect(screen.getByTestId("point-grid-fixture-header")).toHaveClass("sticky");
    expect(screen.getByTestId("point-grid-viewer-header")).toHaveClass("sticky");
    const viewerCellContent = screen.getByTestId("point-grid-viewer-cell");
    expect(viewerCellContent).not.toHaveClass("sticky");
    expect(viewerCellContent.parentElement).toHaveClass("sticky");
    expect(screen.getByTestId("point-grid-edge-cue")).toHaveClass("right-[4.75rem]");
  });

  it("clears the edge cue at the horizontal scroll end", () => {
    render(<PointGrid grid={grid(5)} />);
    const scroll = screen.getByTestId("point-grid-scroll");

    Object.defineProperties(scroll, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 500 },
      scrollLeft: { configurable: true, value: 300, writable: true },
    });
    fireEvent.scroll(scroll);
    expect(screen.queryByTestId("point-grid-edge-cue")).not.toBeInTheDocument();
  });

  it("reveals a player's full name when the header is tapped", () => {
    const view = grid(4);
    view.entrants[0]!.name = "Ananth Menon";
    view.entrants[0]!.initials = "AM";
    render(<PointGrid grid={view} />);

    const header = screen.getByRole("button", {
      name: MATCH_COPY.pointGridShowName("Ananth Menon"),
    });
    fireEvent.click(header);
    expect(screen.getByText("Ananth Menon")).toBeInTheDocument();
  });

  it("does not show a points value for an upcoming cell", () => {
    const view = grid(1);
    view.rows[0]!.fixture.status = "scheduled";
    view.rows[0]!.fixture.homeScore = null;
    view.rows[0]!.fixture.awayScore = null;
    view.rows[0]!.cells[0] = cell([1, 0], null, null);
    view.entrants[0]!.totalPoints = null;
    render(<PointGrid grid={view} />);

    expect(screen.getByText("1–0")).toBeInTheDocument();
    expect(screen.queryByText("+3")).not.toBeInTheDocument();
    expect(screen.queryByText("+1")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
