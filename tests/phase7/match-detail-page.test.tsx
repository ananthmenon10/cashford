import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { Phase4MatchDetailPage } from "../../components/Phase4MatchDetailPage";
import type { MatchDetailView } from "../../lib/match-detail";
import { MATCH_COPY } from "../../lib/match-copy";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

const metadata = {
  source: "ESPN",
  fetchedAt: "2026-08-10T10:00:00.000Z",
  age: "2h ago",
};

function sourced(value: object, source = metadata.source): any {
  return { ...value, ...metadata, source };
}

const homePlayers = Array.from({ length: 11 }, (_, index) => ({
  name: `Home Player ${index + 1}`,
  shirt: index + 1,
}));

const awayPlayers = Array.from({ length: 11 }, (_, index) => ({
  name: `Away Player ${index + 1}`,
  shirt: index + 12,
}));

const realisticLineups = sourced({
  home: { formation: "4-3-3", players: homePlayers },
  away: { formation: "4-4-2", players: awayPlayers },
});

const realisticShots = [
  {
    x: 0.84,
    y: 0.46,
    xg: 0.18,
    minute: 12,
    player: "Saka",
    team: "home",
    result: "saved",
  },
  {
    x: 0.91,
    y: 0.52,
    xg: 0.42,
    minute: 61,
    player: "Palmer",
    team: "away",
    result: "goal",
  },
];

const realisticPlayerStats = [
  {
    name: "Home Player 1",
    team: "home",
    goals: 0,
    assists: 0,
    totalShots: 0,
    shotsOnTarget: 0,
    saves: 3,
    goalsConceded: 1,
    yellowCards: 0,
    redCards: 0,
  },
  {
    name: "Saka",
    team: "home",
    goals: 1,
    assists: 0,
    totalShots: 1,
    shotsOnTarget: 1,
    saves: 0,
    goalsConceded: 1,
    yellowCards: 0,
    redCards: 0,
  },
  {
    name: "Away Player 12",
    team: "away",
    goals: 0,
    assists: 1,
    totalShots: 0,
    shotsOnTarget: 0,
    saves: 0,
    goalsConceded: 0,
    yellowCards: 1,
    redCards: 0,
  },
];

function baseView(state: MatchDetailView["state"]): MatchDetailView {
  return {
    state,
    header: {
      home: { id: "h1", name: "Arsenal" },
      away: { id: "a1", name: "Chelsea" },
      score: state === "pre" ? null : [1, 0],
      status: state === "pre" ? "Fri 15 Aug" : "FT",
      kickoffAt: "2026-08-15T14:00:00.000Z",
      deadlineAt: null,
      scorers: sourced({
        lines: [{ team: "home", player: "Saka", minutes: [12] }],
      }),
    },
    yourCalls: [
      {
        league: { id: "league-1", name: "Solid Yenne Boys", slug: "solid-yenne-boys" },
        anteInr: 10,
        score: [1, 0],
        deadlineAt: "2026-08-15T14:00:00.000Z",
        entered: true,
        points: 3,
      },
    ],
    room: {
      league: { id: "league-1", name: "Solid Yenne Boys", slug: "solid-yenne-boys" },
      leagueOptions: [
        { id: "league-1", name: "Solid Yenne Boys", slug: "solid-yenne-boys" },
      ],
      deadlineAt: "2026-08-15T14:00:00.000Z",
      entrants: [
        { name: "You", score: [1, 0], hidden: false, points: 3 },
        { name: "Mina", score: null, hidden: true },
      ],
    },
    whatIf: { line: "One more Arsenal goal changes the race." },
    raceLink: {
      league: { id: "league-1", name: "Solid Yenne Boys", slug: "solid-yenne-boys" },
      standingLine: "1st of 4 · 3 pts",
      href: "/leagues/solid-yenne-boys",
    },
    notes: [],
  };
}

function viewFor(state: MatchDetailView["state"]): MatchDetailView {
  const view = baseView(state);

  if (state === "pre") {
    view.teamNews = sourced({
      home: [{ player: "Saka", reason: "Fit", status: "i" }],
      away: [],
    }, "FPL");
    view.predictedXi = sourced({
      home: { formation: "4-3-3" },
      away: { formation: "4-4-2" },
      provider: "FotMob",
    }, "FotMob");
  }

  if (state !== "pre") {
    view.keyEvents = sourced({
      timeline: [{
        minute: 12,
        clock: "12'",
        type: "goal",
        team: "home",
        player: "Saka",
        assist: null,
        detail: null,
      }],
    });
    view.teamStats = sourced({
      phase: state === "live" ? "live" : "final",
      minute: state === "live" ? "12'" : null,
      rows: [{ label: "shots", value: { h: 4, a: 2 } }],
    });
    view.playerStats = sourced({ rows: realisticPlayerStats });
    view.lineups = realisticLineups;
    view.commentary = sourced({ lines: [{ minute: "12'", text: "Goal." }] });
  }

  if (state === "post") {
    view.retrospective = sourced({ line: "The match ended 1–0." }, "Cashford model");
    view.xg = sourced({
      home: 1.2,
      away: 0.4,
      provider: "FotMob",
      model: "fotmob-2026",
      afterFt: "1h after full time",
    }, "FotMob");
    view.shotMap = sourced({
      shots: realisticShots,
      provider: "FotMob",
    }, "FotMob");
    view.momentum = sourced({
      series: [{ minute: 12, value: 1 }],
      provider: "FotMob",
    }, "FotMob");
  }

  return view;
}

function emptyOverviewView(): MatchDetailView {
  const view = baseView("pre");
  view.yourCalls = [];
  view.room = null;
  delete view.whatIf;
  delete view.raceLink;
  return view;
}

function panelFor(container: HTMLElement, label: string): HTMLElement {
  const tab = within(container).getByRole("tab", { name: label });
  const panelId = tab.getAttribute("aria-controls");
  const panel = panelId ? container.querySelector(`#${panelId}`) : null;
  if (!panel) throw new Error(`Missing panel for ${label}`);
  return panel as HTMLElement;
}

describe("Phase4MatchDetailPage", () => {
  it.each(["pre", "live", "post"] as const)(
    "renders no raw JSON pre element for the %s state",
    (state) => {
      const { container } = render(
        <Phase4MatchDetailPage fixtureId="fixture-1" view={viewFor(state)} />,
      );
      expect(container.querySelector("pre")).toBeNull();

      const output = container.textContent ?? "";
      if (state === "pre") {
        expect(output).not.toContain(MATCH_COPY.predictedXi);
      }
      if (state === "post") {
        expect(output).toContain(MATCH_COPY.topPerformers);
        expect(output).toContain(MATCH_COPY.shotMap);
        expect(output).not.toContain(MATCH_COPY.momentum);
        expect(output).toContain("Home Player 1");
      }
    },
  );

  it("renders every post-match block in accessible tab panels", () => {
    const { container } = render(
      <Phase4MatchDetailPage fixtureId="fixture-1" view={viewFor("post")} />,
    );
    const tablist = within(container).getByRole("tablist");
    expect(within(tablist).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Lineups",
      "Stats",
      "Shots",
      "Plays",
    ]);

    const overview = panelFor(container, "Overview");
    expect(overview.hidden).toBe(false);
    expect(within(overview).getByText(MATCH_COPY.yourCalls)).toBeInTheDocument();
    expect(within(overview).getByText(MATCH_COPY.timeline)).toBeInTheDocument();

    for (const label of ["Lineups", "Stats", "Shots", "Plays"]) {
      const panel = panelFor(container, label);
      expect(panel).toBeInTheDocument();
      expect(panel.hidden).toBe(true);
    }
    expect(container.querySelectorAll(`[role="tabpanel"]`).length).toBe(5);
    expect(container.textContent).toContain("Home Player 1");
    expect(container.textContent).toContain(MATCH_COPY.postPollNote);
    expect(container.textContent?.match(new RegExp(MATCH_COPY.postPollNote, "g"))).toHaveLength(1);
  });

  it("shows only Overview and Insights for pre-match insight data", () => {
    const { container } = render(
      <Phase4MatchDetailPage fixtureId="fixture-1" view={viewFor("pre")} />,
    );
    const tablist = within(container).getByRole("tablist");
    expect(within(tablist).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Insights",
    ]);
    expect(container.textContent).toContain(MATCH_COPY.teamNews);
    expect(container.textContent).not.toContain("Shots");
    expect(container.textContent).not.toContain("Stats");
  });

  it("omits the tab bar when Overview is the only populated tab", () => {
    const { container } = render(
      <Phase4MatchDetailPage fixtureId="fixture-1" view={emptyOverviewView()} />,
    );
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).toContain(MATCH_COPY.fixturesAndResults);
  });

  it("selects the initial tab and falls back to Overview for an unknown tab", () => {
    const shotsRender = render(
      <Phase4MatchDetailPage
        fixtureId="fixture-1"
        view={viewFor("post")}
        initialTab="shots"
      />,
    );
    expect(within(shotsRender.container).getByRole("tab", { name: "Shots" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(panelFor(shotsRender.container, "Shots").hidden).toBe(false);
    shotsRender.unmount();

    const overviewRender = render(
      <Phase4MatchDetailPage
        fixtureId="fixture-1"
        view={viewFor("post")}
        initialTab="bogus"
      />,
    );
    expect(within(overviewRender.container).getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(panelFor(overviewRender.container, "Overview").hidden).toBe(false);
  });

  it("switches visible panels on a chip click and merges tab state into the URL", () => {
    window.history.replaceState({}, "", "/m/fixture-1?league=solid-yenne-boys");
    const { container } = render(
      <Phase4MatchDetailPage fixtureId="fixture-1" view={viewFor("post")} />,
    );
    const statsTab = within(container).getByRole("tab", { name: "Stats" });

    expect(() => fireEvent.click(statsTab)).not.toThrow();
    expect(statsTab).toHaveAttribute("aria-selected", "true");
    expect(panelFor(container, "Overview").hidden).toBe(true);
    expect(panelFor(container, "Stats").hidden).toBe(false);
    expect(window.location.search).toBe("?league=solid-yenne-boys&tab=stats");

    expect(() => fireEvent.click(within(container).getByRole("tab", { name: "Overview" }))).not.toThrow();
    expect(window.location.search).toBe("?league=solid-yenne-boys");
  });
});
