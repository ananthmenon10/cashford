// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LineupsBlock } from "../../components/matches/LineupsBlock";
import { PlayerStatsBlock } from "../../components/matches/PlayerStatsBlock";
import { ShotsBlock } from "../../components/matches/ShotsBlock";
import {
  coerceLineups,
  coercePlayerStats,
  coerceShots,
  type Club,
  type MatchDetailView,
} from "../../lib/match-detail";
import type { Sourced } from "../../lib/match-blocks";

afterEach(() => cleanup());

const sample = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "docs/design/throwaway/match-blocks-sample-data.json",
    ),
    "utf8",
  ),
) as {
  player_stats: unknown[];
  lineups: unknown;
  shots: unknown[];
};

const home: Club = { id: "tot", name: "Tottenham" };
const away: Club = { id: "new", name: "Newcastle" };

function sourced<T extends object>(value: T, source = "ESPN"): Sourced<T> {
  return {
    ...value,
    source,
    fetchedAt: "2026-08-30T10:00:00.000Z",
    age: "2h ago",
  };
}

const lineups = sourced({
  ...coerceLineups(sample.lineups)!,
}) as MatchDetailView["lineups"];
const playerStats = sourced({
  rows: coercePlayerStats(sample.player_stats)!,
}) as MatchDetailView["playerStats"];
const shotMap = sourced({
  shots: coerceShots(sample.shots)!,
  provider: "FotMob" as const,
}) as MatchDetailView["shotMap"];

describe("LineupsBlock", () => {
  it("renders both formation-derived pitches with 11 pins and a keeper-first row", () => {
    render(<LineupsBlock lineups={lineups} home={home} away={away} />);

    expect(screen.getAllByTestId("lineup-pin-home")).toHaveLength(11);
    expect(screen.getAllByTestId("lineup-pin-away")).toHaveLength(11);
    expect(screen.getAllByText("4-2-3-1")).toHaveLength(2);
    expect(screen.getByTestId("lineup-home-row-0")).toHaveTextContent("31");
    expect(screen.getByTestId("lineup-home-row-0")).toHaveTextContent("Kinsky");
    expect(screen.getByText("ESPN · 2h ago")).toBeInTheDocument();
  });

  it("falls back to even formation rows without dropping players", () => {
    const garbled = sourced({
      home: { ...lineups!.home, formation: "not-a-formation" },
      away: lineups!.away,
    }) as MatchDetailView["lineups"];

    render(<LineupsBlock lineups={garbled} home={home} away={away} />);

    expect(screen.getAllByTestId("lineup-pin-home")).toHaveLength(11);
    expect(screen.getAllByTestId("lineup-pin-away")).toHaveLength(11);
    expect(screen.getByTestId("lineup-home-row-0")).toHaveTextContent("Kinsky");
    expect(screen.getByText("not-a-formation")).toBeInTheDocument();
  });
});

describe("PlayerStatsBlock", () => {
  it("puts xG, scorer, and keeper spotlights before the event ledger", () => {
    render(
      <PlayerStatsBlock
        playerStats={playerStats}
        shotMap={shotMap}
        lineups={lineups}
        home={home}
        away={away}
      />,
    );

    expect(screen.getAllByText("Yoane Wissa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.62 xG").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Anthony Elanga").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4 saves").length).toBeGreaterThan(0);
    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.getByText("Danger")).toBeInTheDocument();
    expect(screen.getByText("ESPN · 2h ago")).toBeInTheDocument();
    expect(screen.queryByText(/rating/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tackles|defensive|DEFCON/i)).not.toBeInTheDocument();
  });

  it("renders the live shape without shots and uses save-makers as keepers", () => {
    expect(() =>
      render(
        <PlayerStatsBlock
          playerStats={playerStats}
          lineups={undefined}
          shotMap={undefined}
          home={home}
          away={away}
        />,
      ),
    ).not.toThrow();

    expect(screen.getAllByText("Anthony Elanga").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4 saves").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Danger/)).not.toBeInTheDocument();
    expect(screen.queryByText(/xG/)).not.toBeInTheDocument();
  });
});

describe("ShotsBlock", () => {
  it("renders one selectable dot for every shot and the rounded combined xG", () => {
    render(<ShotsBlock shotMap={shotMap} home={home} away={away} />);

    expect(screen.getAllByTestId("shot-dot")).toHaveLength(28);
    expect(screen.getByText("2.15")).toBeInTheDocument();
    expect(screen.getByText("ESPN · 2h ago")).toBeInTheDocument();
    expect(screen.getAllByTestId("shot-dot")[0]).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("reveals a shot detail row when a dot is selected", () => {
    render(<ShotsBlock shotMap={shotMap} home={home} away={away} />);

    fireEvent.click(screen.getAllByTestId("shot-dot")[0]);

    expect(screen.getByTestId("shot-detail")).toHaveTextContent("Mathys Tel");
    expect(screen.getByTestId("shot-detail")).toHaveTextContent("14′");
    expect(screen.getByTestId("shot-detail")).toHaveTextContent("Saved");
    expect(screen.getByTestId("shot-detail")).toHaveTextContent("0.05");
  });

  it("renders an other-result shot without crashing", () => {
    const withOther = sourced({
      shots: [{ ...shotMap!.shots[0], result: "other" as const }],
      provider: "FotMob" as const,
    }) as MatchDetailView["shotMap"];

    render(<ShotsBlock shotMap={withOther} home={home} away={away} />);

    expect(screen.getAllByText("Other").length).toBeGreaterThan(0);
  });
});

describe("match block absence", () => {
  it("renders nothing when each component's required block is absent", () => {
    const lineupsRender = render(
      <LineupsBlock home={home} away={away} lineups={undefined} />,
    );
    expect(lineupsRender.container).toBeEmptyDOMElement();
    cleanup();

    const statsRender = render(
      <PlayerStatsBlock home={home} away={away} playerStats={undefined} />,
    );
    expect(statsRender.container).toBeEmptyDOMElement();
    cleanup();

    const shotsRender = render(
      <ShotsBlock home={home} away={away} shotMap={undefined} />,
    );
    expect(shotsRender.container).toBeEmptyDOMElement();
  });
});
