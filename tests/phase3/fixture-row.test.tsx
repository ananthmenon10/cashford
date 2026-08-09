import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FixtureRow } from "../../components/gw/FixtureRow";
import type { GameweekViewDTO } from "../../lib/gw-view";

afterEach(() => cleanup());

function fixture(): GameweekViewDTO["fixtures"][number] {
  return {
    fixtureId: "f1",
    membershipId: "m-f1",
    state: "active",
    voidReason: null,
    kickoffAt: null,
    status: "scheduled",
    minute: null,
    homeScore: null,
    awayScore: null,
    homeName: "Home",
    awayName: "Away",
    homeShort: "HOM",
    awayShort: "AWY",
  };
}

describe("FixtureRow revealed prediction pills", () => {
  it("shows the member name next to the scoreline", () => {
    render(
      <FixtureRow
        fixture={fixture()}
        picks={[{ userId: "u1", fixtureId: "f1", name: "TESTA", predHome: 2, predAway: 1 }]}
      />,
    );

    expect(screen.getByText("TESTA")).toBeInTheDocument();
    expect(screen.getByText("2–1")).toBeInTheDocument();
  });

  it("renders a neutral fallback when a revealed pick has no matching member name", () => {
    render(
      <FixtureRow
        fixture={fixture()}
        picks={[{ userId: "unknown-user", fixtureId: "f1", name: null, predHome: 0, predAway: 0 }]}
      />,
    );

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("0–0")).toBeInTheDocument();
  });
});
