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
  ScorersLine,
  TeamNewsModule,
  TimelineModule,
  TeamStatsModule,
  CommentaryModule,
  XgModule,
  RatingsModule,
  RetrospectiveModule,
} from "../../components/matches/MatchInsightModules";
import type { MatchDetailView } from "../../lib/match-detail";
import type { Club } from "../../lib/match-detail";
import { fplStatusLabel } from "../../lib/match-copy";

afterEach(() => cleanup());

const home: Club = { id: "h1", name: "Arsenal" };
const away: Club = { id: "a1", name: "Chelsea" };

function block(value: object, source = "ESPN"): any {
  return { ...value, source, fetchedAt: "2026-08-10T10:00:00.000Z", age: "2h ago" };
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

describe("ScorersLine", () => {
  it("keeps home scorers left, away scorers right, and puts the source footer in the header slot", () => {
    const scorers: MatchDetailView["header"]["scorers"] = block({
      lines: [
        { team: "home", player: "Curtis Jones", minutes: [58] },
        { team: "away", player: "Kevin Schade", minutes: [64] },
      ],
    });
    render(<ScorersLine scorers={scorers} home={home} away={away} />);
    expect(screen.getByText("Curtis Jones")).toBeInTheDocument();
    expect(screen.getByText("Kevin Schade")).toBeInTheDocument();
    expect(screen.getByText("58′")).toBeInTheDocument();
    expect(screen.getByText("64′")).toBeInTheDocument();
    expect(screen.getByText("ESPN · 2h ago")).toBeInTheDocument();
  });

  it("renders nothing when scorers are absent", () => {
    const { container } = render(<ScorersLine home={home} away={away} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TeamNewsModule", () => {
  it("renders two club columns, maps FPL status labels, and shows No news for an empty side", () => {
    const teamNews: MatchDetailView["teamNews"] = block({
      home: [],
      away: [
        { player: "Jackson", reason: "Ankle injury", status: "i" },
        { player: "Odegaard", reason: "Being assessed", status: "d" },
        { player: "Player", reason: "Serving suspension", status: "s" },
        { player: "Unavailable", reason: "Unavailable", status: "u" },
        { player: "Not in squad", reason: "Not in squad", status: "n" },
      ],
    }, "FPL");
    render(<TeamNewsModule teamNews={teamNews} home={home} away={away} />);
    expect(screen.getByText("No news")).toBeInTheDocument();
    expect(screen.getAllByText("Out")).toHaveLength(2);
    expect(screen.getByText("Injured")).toBeInTheDocument();
    expect(screen.getByText("Doubtful")).toBeInTheDocument();
    expect(screen.getByText("Suspended")).toBeInTheDocument();
    expect(screen.getByText("Ankle injury")).toBeInTheDocument();
    expect(screen.getByText("FPL · 2h ago")).toBeInTheDocument();
  });

  it("uses an em-dash for a missing individual reason", () => {
    const teamNews: MatchDetailView["teamNews"] = block({
      home: [{ player: "Jackson", reason: null as unknown as string, status: "i" }],
      away: [],
    });
    render(<TeamNewsModule teamNews={teamNews} home={home} away={away} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders nothing when team news is absent", () => {
    const { container } = render(<TeamNewsModule home={home} away={away} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("fplStatusLabel", () => {
  it("maps every FPL status letter to its approved label", () => {
    expect(fplStatusLabel("d")).toBe("Doubtful");
    expect(fplStatusLabel("i")).toBe("Injured");
    expect(fplStatusLabel("s")).toBe("Suspended");
    expect(fplStatusLabel("u")).toBe("Out");
    expect(fplStatusLabel("n")).toBe("Out");
  });
});

describe("TimelineModule", () => {
  it("uses short text labels for every supported event type and keeps the source footer", () => {
    const timeline: MatchDetailView["keyEvents"] = block({
      timeline: [
        { minute: 12, clock: "12'", type: "goal", team: "home", player: "Saka", assist: null, detail: null },
        { minute: 13, clock: "13'", type: "own_goal", team: "away", player: "Saliba", assist: null, detail: null },
        { minute: 14, clock: "14'", type: "pen", team: "home", player: "Havertz", assist: null, detail: null },
        { minute: 15, clock: "15'", type: "miss_pen", team: "away", player: "Jackson", assist: null, detail: null },
        { minute: 16, clock: "16'", type: "yellow", team: "home", player: "Rice", assist: null, detail: null },
        { minute: 17, clock: "17'", type: "red", team: "away", player: "Silva", assist: null, detail: null },
        { minute: 18, clock: "18'", type: "sub", team: "home", player: "Martinelli", assist: null, detail: null },
        { minute: 19, clock: "19'", type: "var", team: "away", player: "Referee", assist: null, detail: null },
      ],
    });
    render(<TimelineModule keyEvents={timeline} home={home} away={away} />);
    for (const label of [
      "Goal",
      "Own goal",
      "Penalty",
      "Penalty missed",
      "Yellow card",
      "Red card",
      "Substitution",
      "VAR",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const expectedClassesByLabel: Record<string, string[]> = {
      Goal: ["bg-mint", "text-primary-press"],
      "Own goal": ["bg-amber-bg", "text-amber-fg"],
      Penalty: ["bg-mint", "text-primary-press"],
      "Penalty missed": ["bg-amber-bg", "text-amber-fg"],
      "Yellow card": ["bg-amber-bg", "text-amber-fg"],
      "Red card": ["bg-[#FEE2E2]", "text-loss", "dark:bg-[#ef44441f]"],
      Substitution: ["bg-subtle", "text-muted"],
      VAR: ["bg-subtle", "text-muted"],
    };
    for (const [label, expectedClasses] of Object.entries(expectedClassesByLabel)) {
      const badge = screen.getByText(label);
      for (const expectedClass of expectedClasses) {
        expect(badge.className).toContain(expectedClass);
      }
    }
    expect(screen.getAllByText("Arsenal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chelsea").length).toBeGreaterThan(0);
    expect(screen.getByText("ESPN · 2h ago")).toBeInTheDocument();
  });

  it("uses an em-dash for a missing event player", () => {
    const timeline: MatchDetailView["keyEvents"] = block({
      timeline: [{ minute: 12, clock: "12'", type: "goal", team: "home", player: null as unknown as string, assist: null, detail: null }],
    });
    render(<TimelineModule keyEvents={timeline} home={home} away={away} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders nothing when the timeline is absent", () => {
    const { container } = render(<TimelineModule home={home} away={away} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TeamStatsModule", () => {
  it("renders typed home/away values with labels, a two-tone bar, and a source footer", () => {
    const teamStats: MatchDetailView["teamStats"] = block({
      phase: "final",
      minute: null,
      rows: [
        { label: "shots", value: { h: 24, a: 11 } },
        { label: "possession", value: { h: 60.2, a: 39.8 } },
      ],
    });
    const { container } = render(<TeamStatsModule teamStats={teamStats} />);
    expect(screen.getByText("Shots")).toBeInTheDocument();
    expect(screen.getByText("Possession")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("60.2")).toBeInTheDocument();
    expect(screen.getByText("39.8")).toBeInTheDocument();
    expect(screen.getByText("ESPN · 2h ago")).toBeInTheDocument();
    expect(container.querySelectorAll('[style*="width"]').length).toBeGreaterThan(0);
  });

  it("uses an em-dash for a missing stat value", () => {
    const teamStats: MatchDetailView["teamStats"] = block({
      phase: "final",
      minute: null,
      rows: [{ label: "shots", value: { h: null as unknown as number, a: 11 } }],
    });
    render(<TeamStatsModule teamStats={teamStats} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders nothing when team stats are absent", () => {
    const { container } = render(<TeamStatsModule />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CommentaryModule", () => {
  const commentary: MatchDetailView["commentary"] = block({
    lines: [
      { minute: "1'", text: "First" },
      { minute: "2'", text: "Second" },
      { minute: "3'", text: "Third" },
    ],
  });

  it("shows live commentary newest first", () => {
    const { container } = render(<CommentaryModule commentary={commentary} state="live" />);
    const content = container.textContent ?? "";
    expect(content.indexOf("Third")).toBeLessThan(content.indexOf("Second"));
    expect(content.indexOf("Second")).toBeLessThan(content.indexOf("First"));
    expect(screen.getByText("ESPN · 2h ago")).toBeInTheDocument();
  });

  it("shows finished commentary oldest first and uses an em-dash for an empty minute", () => {
    const postCommentary: MatchDetailView["commentary"] = block({
      lines: [
        { minute: "2'", text: "Second" },
        { minute: "", text: "Before kickoff" },
        { minute: "1'", text: "First" },
      ],
    });
    const { container } = render(<CommentaryModule commentary={postCommentary} state="post" />);
    const content = container.textContent ?? "";
    expect(content.indexOf("Before kickoff")).toBeLessThan(content.indexOf("First"));
    expect(content.indexOf("First")).toBeLessThan(content.indexOf("Second"));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders nothing when commentary is absent", () => {
    const { container } = render(<CommentaryModule state="post" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("XgModule", () => {
  it("renders both expected-goal values and the provider/model metadata line", () => {
    const xg: MatchDetailView["xg"] = block({
      home: 1.8,
      away: 0.7,
      provider: "FotMob",
      model: "fotmob-2026",
      afterFt: "1h 2m after full time",
    });
    render(<XgModule xg={xg} home={home} away={away} />);
    expect(screen.getByText("1.80")).toBeInTheDocument();
    expect(screen.getByText("0.70")).toBeInTheDocument();
    expect(screen.getByText("FotMob · fotmob-2026 · 1h 2m after full time")).toBeInTheDocument();
    expect(screen.getByText("ESPN · 2h ago")).toBeInTheDocument();
  });

  it("uses em-dashes for missing individual expected-goal fields", () => {
    const xg: MatchDetailView["xg"] = block({
      home: null as unknown as number,
      away: 0.7,
      provider: "FotMob",
      model: null as unknown as string,
      afterFt: "",
    });
    render(<XgModule xg={xg} home={home} away={away} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders nothing when expected goals are absent", () => {
    const { container } = render(<XgModule home={home} away={away} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RatingsModule", () => {
  it("renders a realistic FotMob PotM row, a short ratings list, and its source footer", () => {
    const ratings: MatchDetailView["ratings"] = block({
      potm: { player: "Bukayo Saka", team: "home", rating: 8.4, goals: 1 },
      others: [
        { player: "Martin Odegaard", team: "home", rating: 7.7 },
        { player: "William Saliba", team: "away", rating: 7.3 },
      ],
      provider: "FotMob",
    }, "FotMob");
    render(<RatingsModule ratings={ratings} home={home} away={away} />);
    expect(screen.getByText("Bukayo Saka")).toBeInTheDocument();
    expect(screen.getByText("8.4")).toBeInTheDocument();
    expect(screen.getByText("Martin Odegaard")).toBeInTheDocument();
    expect(screen.getByText("7.7")).toBeInTheDocument();
    expect(screen.getByText("FotMob · 2h ago")).toBeInTheDocument();
  });

  it("uses an em-dash for a missing player rating", () => {
    const ratings: MatchDetailView["ratings"] = block({
      potm: { player: "Bukayo Saka", team: "home", rating: null as unknown as number },
      others: [],
      provider: "FotMob",
    });
    render(<RatingsModule ratings={ratings} home={home} away={away} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders nothing when ratings are absent", () => {
    const { container } = render(<RatingsModule home={home} away={away} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RetrospectiveModule", () => {
  it("renders the model retrospective as a paragraph with a source footer", () => {
    const retrospective: MatchDetailView["retrospective"] = block({
      line: "The model gave 2–1 a 18% chance. Its top score was 2–1.",
    }, "Cashford model");
    render(<RetrospectiveModule retrospective={retrospective} />);
    expect(screen.getByText(retrospective!.line)).toBeInTheDocument();
    expect(screen.getByText("Cashford model · 2h ago")).toBeInTheDocument();
  });

  it("uses an em-dash for a missing retrospective line", () => {
    const retrospective: MatchDetailView["retrospective"] = block({
      line: null as unknown as string,
    });
    render(<RetrospectiveModule retrospective={retrospective} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders nothing when the retrospective is absent", () => {
    const { container } = render(<RetrospectiveModule />);
    expect(container).toBeEmptyDOMElement();
  });
});
