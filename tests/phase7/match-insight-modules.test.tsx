// Step 9 (#16) — render tests for the designed insight modules that replaced the raw JSON dumps
// on the gameweek match-detail screen. Each module must hide itself (render null) when its block
// is absent, and never print "undefined"/"NaN" when a present block has partial data.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  OddsModule,
  FormModule,
  H2HModule,
  TableModule,
} from "../../components/matches/MatchInsightModules";
import type { MatchDetailView } from "../../lib/match-detail";
import type { Club } from "../../lib/match-detail";

afterEach(() => cleanup());

const home: Club = { id: "h1", name: "Arsenal" };
const away: Club = { id: "a1", name: "Chelsea" };

function block<T extends object>(value: T): T & { source: string; fetchedAt: string; age: string } {
  return { ...value, source: "ESPN", fetchedAt: "2026-08-10T10:00:00.000Z", age: "2h ago" };
}

describe("OddsModule", () => {
  it("renders nothing when both odds and model are absent", () => {
    const { container } = render(<OddsModule home={home} away={away} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 1X2 percentages and the model's top scores/BTTS/clean sheets when present", () => {
    const odds: MatchDetailView["odds"] = block({
      pHome: 0.62,
      pDraw: 0.24,
      pAway: 0.14,
      mlHome: -195,
      mlDraw: 260,
      mlAway: 370,
      book: "ESPN BET",
    });
    const model: MatchDetailView["model"] = block({
      topScores: [{ h: 2, a: 1, p: 0.18 }],
      btts: 0.55,
      cleanSheets: [0.3, 0.2] as [number, number],
      pOver: 0.6,
      totalLine: 2.5,
    });
    render(<OddsModule odds={odds} model={model} home={home} away={away} />);
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("24%")).toBeInTheDocument();
    expect(screen.getByText("14%")).toBeInTheDocument();
    expect(screen.getByText("2–1")).toBeInTheDocument();
    expect(screen.getByText("Over 2.5 goals")).toBeInTheDocument();
    expect(screen.getByText(/ESPN BET/)).toBeInTheDocument();
    expect(screen.queryByText(/undefined|NaN/)).not.toBeInTheDocument();
  });

  it("falls back to an em-dash rather than NaN when a probability is missing", () => {
    const odds: MatchDetailView["odds"] = block({
      pHome: 0.62,
      pDraw: null as unknown as number,
      pAway: 0.14,
      mlHome: -195,
      mlDraw: 260,
      mlAway: 370,
      book: "ESPN BET",
    });
    render(<OddsModule odds={odds} home={home} away={away} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("shows an em-dash for the model's own missing sub-fields (p_btts null), never 0%", () => {
    const model: MatchDetailView["model"] = block({
      topScores: [{ h: 2, a: 1, p: 0.18 }],
      btts: null,
      cleanSheets: [0.3, 0.2] as [number, number],
      pOver: 0.6,
      totalLine: 2.5,
    });
    render(<OddsModule model={model} home={home} away={away} />);
    const bothScoreCaption = screen.getByText("Both score");
    expect(bothScoreCaption.previousSibling).toHaveTextContent("—");
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
});

describe("FormModule", () => {
  it("renders nothing when form is absent", () => {
    const { container } = render(<FormModule home={home} away={away} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders W/D/L chips per team and a fallback line for a team with no games", () => {
    const form: MatchDetailView["form"] = block({
      home: [{ result: "W", score: "2-1", opponent: "Fulham", date: "2026-08-01" }],
      away: [],
    });
    render(<FormModule form={form} home={home} away={away} />);
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(screen.getByText("No recent matches.")).toBeInTheDocument();
  });
});

describe("H2HModule", () => {
  it("renders nothing when h2h is absent", () => {
    const { container } = render(<H2HModule home={home} away={away} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the summary and a fallback line when there are no games", () => {
    const h2h: MatchDetailView["h2h"] = block({ summary: "First meeting", games: [] });
    render(<H2HModule h2h={h2h} home={home} away={away} />);
    expect(screen.getByText("First meeting")).toBeInTheDocument();
    expect(screen.getByText("No recent meetings.")).toBeInTheDocument();
  });

  it("shows each meeting oriented to the current fixture's home team", () => {
    const h2h: MatchDetailView["h2h"] = block({
      summary: "Arsenal won 2 of the last 3",
      games: [
        { date: "2026-01-10T15:00:00.000Z", competition: "Premier League", homeScore: 2, awayScore: 1 },
      ],
    });
    render(<H2HModule h2h={h2h} home={home} away={away} />);
    expect(screen.getByText(/Arsenal 2–1 Chelsea/)).toBeInTheDocument();
  });
});

describe("TableModule", () => {
  it("renders nothing when table is absent", () => {
    const { container } = render(<TableModule />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the standings rows through the shared CompetitionTable", () => {
    const table: MatchDetailView["table"] = {
      window: [
        {
          rank: 1,
          club: "Arsenal",
          club_id: "h1",
          played: 1,
          won: 1,
          drawn: 0,
          lost: 0,
          gd: 2,
          points: 3,
          form: ["W"],
        },
      ],
      note: null,
      source: "espn",
      fetchedAt: "2026-08-10T10:00:00.000Z",
      age: "2h ago",
    };
    render(<TableModule table={table} />);
    expect(screen.getByText("Arsenal")).toBeInTheDocument();
  });

  it("renders buildStandingsView's own cased source line, not a raw source/age string", () => {
    const table: MatchDetailView["table"] = {
      window: [
        {
          rank: 1,
          club: "Arsenal",
          club_id: "h1",
          played: 1,
          won: 1,
          drawn: 0,
          lost: 0,
          gd: 2,
          points: 3,
          form: ["W"],
        },
      ],
      note: null,
      source: "espn",
      fetchedAt: "2026-08-10T10:00:00.000Z",
      age: "2h ago",
    };
    render(<TableModule table={table} />);
    // "ESPN · updated …" only ever comes from buildStandingsView's sourceLine — a hand-built
    // "espn · 2h ago" footer (the bug being fixed) would never say "updated".
    expect(screen.getByText(/ESPN · updated/)).toBeInTheDocument();
  });
});
