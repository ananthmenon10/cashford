import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Phase4MatchDetailPage } from "../../components/Phase4MatchDetailPage";
import type { MatchDetailView } from "../../lib/match-detail";

afterEach(() => cleanup());

const metadata = {
  source: "ESPN",
  fetchedAt: "2026-08-10T10:00:00.000Z",
  age: "2h ago",
};

function sourced(value: object, source = metadata.source): any {
  return { ...value, ...metadata, source };
}

function viewFor(state: MatchDetailView["state"]): MatchDetailView {
  const view: MatchDetailView = {
    state,
    header: {
      home: { id: "h1", name: "Arsenal" },
      away: { id: "a1", name: "Chelsea" },
      score: state === "pre" ? null : [1, 0],
      status: state === "pre" ? "Fri 15 Aug" : "12' · LIVE",
      kickoffAt: "2026-08-15T14:00:00.000Z",
      deadlineAt: null,
      scorers: sourced({
        lines: [{ team: "home", player: "Saka", minutes: [12] }],
      }),
    },
    yourCalls: [],
    room: null,
    notes: [],
  };

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
      timeline: [{ minute: 12, clock: "12'", type: "goal", team: "home", player: "Saka", assist: null, detail: null }],
    });
    view.teamStats = sourced({
      phase: state === "live" ? "live" : "final",
      minute: state === "live" ? "12'" : null,
      rows: [{ label: "shots", value: { h: 4, a: 2 } }],
    });
    view.playerStats = sourced({ rows: [{ player: "Saka" }] });
    view.lineups = sourced({
      home: { formation: "4-3-3" },
      away: { formation: "4-4-2" },
    });
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
      shots: [{ team: "home", minute: 12 }],
      provider: "FotMob",
    }, "FotMob");
    view.ratings = sourced({
      potm: { player: "Saka", team: "home", rating: 8.4 },
      others: [],
      provider: "FotMob",
    }, "FotMob");
    view.momentum = sourced({
      series: [{ minute: 12, value: 1 }],
      provider: "FotMob",
    }, "FotMob");
  }

  return view;
}

describe("Phase4MatchDetailPage", () => {
  it.each(["pre", "live", "post"] as const)(
    "renders no raw JSON pre element for the %s state",
    (state) => {
      const { container } = render(
        <Phase4MatchDetailPage fixtureId="fixture-1" view={viewFor(state)} />,
      );
      expect(container.querySelector("pre")).toBeNull();
    },
  );
});
