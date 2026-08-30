import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { YouVsRoom } from "../../components/analytics/YouVsRoom";
import { Rivalry } from "../../components/analytics/Rivalry";
import { PredictionHabits } from "../../components/analytics/PredictionHabits";
import { WeeklyLabels } from "../../components/analytics/WeeklyLabels";
import { ANALYTICS_COPY } from "../../lib/analytics-copy";
import type { AnalyticsYouVsRoom } from "../../lib/analytics-room";
import type { AnalyticsRivalry } from "../../lib/analytics-rivalry";
import type { AnalyticsHabits } from "../../lib/analytics-habits";
import type { AnalyticsWeeklyLabels } from "../../lib/analytics-labels";

afterEach(() => cleanup());

const room: AnalyticsYouVsRoom = {
  windowGameweeks: [1],
  otherMemberCount: 2,
  metrics: {
    exactRate: { viewer: 0.5, otherAverage: 0.25, difference: 0.25, otherCount: 2 },
    resultRate: { viewer: null, otherAverage: null, difference: null, otherCount: 0 },
    avgGoalMiss: { viewer: 1, otherAverage: 1.5, difference: -0.5, otherCount: 2 },
    last5Form: { viewer: 1, otherAverage: 0.5, difference: 0.5, otherCount: 2 },
  },
  exactRateBars: [{ userId: "viewer", rate: 0.5, isViewer: true }],
  sentence: null,
};

const rivalry: AnalyticsRivalry = {
  options: [{ userId: "rival", name: "Rival" }],
  byRivalId: {
    rival: {
      won: 1,
      lost: 0,
      tied: 0,
      viewerExacts: 2,
      rivalExacts: 1,
      sharedGameweeks: 1,
      settledGameweeks: 1,
      excludedGameweeks: [],
      currentRunLength: 1,
      runOwner: "viewer",
      biggestSwing: null,
    },
  },
  defaultRivalId: "rival",
};

const weeklyLabels: AnalyticsWeeklyLabels = {
  gwNumber: 1,
  entrantCount: 3,
  countedFixtures: 10,
  labels: [
    {
      key: "oracle",
      emoji: "🔮",
      name: "Oracle",
      awarded: { userId: "u1", name: "Ananth", isViewer: true, value: 2, runnerUp: 1 },
      notAwardedReason: null,
    },
    {
      key: "nearly",
      emoji: "😩",
      name: "Nearly",
      awarded: { userId: "rival", name: "Rival", isViewer: false, value: 4, runnerUp: 3 },
      notAwardedReason: null,
    },
    {
      key: "crowd",
      emoji: "🐑",
      name: "The Crowd",
      awarded: null,
      notAwardedReason: "Nobody cleared the bar for The Crowd this week.",
    },
    {
      key: "maverick",
      emoji: "🎲",
      name: "Maverick",
      awarded: null,
      notAwardedReason: "Maverick ended level this week — no single winner.",
    },
  ],
};

const habits: AnalyticsHabits = {
  gameweeks: [1],
  pickCount: 20,
  mostCalled: { predHome: 2, predAway: 1, count: 8 },
  drawRate: 0.2,
  actualDrawRate: 0.3,
  homeBias: 0.6,
  actualHomeWinRate: 0.5,
  averageGoalsPredicted: 2.7,
  averageGoalsScored: 2.9,
  goalsDelta: -0.2,
  consensus: {
    withCrowd: { count: 8, rate: 0.4 },
    against: { count: 8, rate: 0.4, correct: 0.5 },
    noConsensus: { count: 4, rate: 0.2 },
  },
  sentence: { againstCorrect: 4, againstCount: 8 },
};

describe("analytics module components", () => {
  it("render nothing for hidden modules", () => {
    const { container } = render(
      <>
        <YouVsRoom module={null} />
        <Rivalry module={null} />
        <PredictionHabits module={null} />
        <WeeklyLabels module={null} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders populated room metrics and omits its null row", () => {
    render(<YouVsRoom module={room} />);
    expect(screen.getByText("50% · 25% · +25%")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByText("Result rate")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("renders a measured zero bar while null-data members stay omitted", () => {
    render(
      <YouVsRoom
        module={{
          ...room,
          exactRateBars: [
            { userId: "testa", name: "TESTA", rate: 5 / 15, isViewer: true },
            { userId: "testb", name: "TESTB", rate: 0 },
            { userId: "testc", name: "TESTC", rate: 5 / 15 },
            { userId: "testd", name: "TESTD", rate: 4 / 15 },
          ],
        }}
      />,
    );
    expect(screen.getByText("TESTB")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.queryByText("Ananth")).not.toBeInTheDocument();
  });

  it("renders the rivalry record and selected rival", () => {
    render(<Rivalry module={rivalry} />);
    expect(screen.getAllByText("Rival").length).toBeGreaterThan(0);
    expect(screen.getByText("Won")).toBeInTheDocument();
    expect(screen.getByText("Lost")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "2–1")).toBeInTheDocument();
    expect(screen.queryByText(/Biggest swing:/)).not.toBeInTheDocument();
  });

  it("renders the rivalry swing in the existing note block when present", () => {
    const swing = {
      gwNumber: 1,
      fixtureId: "f1",
      homeShort: "IPS",
      awayShort: "SUN",
      ftHome: 2,
      ftAway: 1,
      viewerPts: 3,
      rivalPts: 0,
    };
    render(
      <Rivalry
        module={{
          ...rivalry,
          byRivalId: { rival: { ...rivalry.byRivalId.rival, biggestSwing: swing } },
        }}
      />,
    );
    expect(screen.getByText(ANALYTICS_COPY.rivalrySwing(1, "IPS", 2, 1, "SUN", 3, 0))).toBeInTheDocument();
  });

  it("renders four weekly labels in half-width cells with award and suppressed states", () => {
    render(<WeeklyLabels module={weeklyLabels} />);

    expect(screen.getByText(ANALYTICS_COPY.weeklyLabelsTitle)).toBeInTheDocument();
    expect(screen.getByText(ANALYTICS_COPY.weeklyLabelsSub(1, 3, 10))).toBeInTheDocument();
    expect(screen.getAllByTestId("weekly-label")).toHaveLength(4);
    expect(screen.getAllByTestId("weekly-label-awarded")).toHaveLength(2);
    expect(screen.getAllByTestId("weekly-label-off")).toHaveLength(2);

    const viewerCard = screen.getAllByTestId("weekly-label-awarded").find((item) =>
      item.textContent?.includes(ANALYTICS_COPY.weeklyLabelYou),
    );
    expect(viewerCard).toBeDefined();
    expect(viewerCard?.parentElement).toHaveClass("bg-cs2-green-soft", "border-cs2-green-line");
    expect(viewerCard?.querySelector(".text-cs2-green")).not.toBeNull();

    for (const card of screen.getAllByTestId("weekly-label")) {
      expect(card).not.toHaveClass("col-span-2");
    }
    for (const card of screen.getAllByTestId("weekly-label-off")) {
      expect(card.parentElement).toHaveClass("border-dashed", "bg-cs2-canvas");
      expect(card.querySelector(".opacity-40.grayscale")).not.toBeNull();
    }
  });

  it("renders habits statistics and consensus without filling missing rows with zero", () => {
    render(<PredictionHabits module={habits} />);
    expect(screen.getByText("2–1 · 8 of 20 picks")).toBeInTheDocument();
    expect(screen.getAllByText("40%")).toHaveLength(2);
    expect(screen.getByText("Against the crowd, you got 4 of 8 right.")).toBeInTheDocument();
  });
});
