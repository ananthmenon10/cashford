// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GameweekStrip } from "../../components/gw/GameweekStrip";

afterEach(() => cleanup());

const gameweek = {
  id: "gw3",
  number: 3,
  name: "Gameweek 3",
  status: "open",
  deadlineAt: "2026-08-24T12:00:00.000Z",
};

describe("GameweekStrip L1 access", () => {
  it("keeps unavailable Now and Last segments visible and disabled", () => {
    render(
      <GameweekStrip
        slug="friends"
        gameweek={gameweek}
        adjacent={[]}
        gameweekAccess={{ now: null, last: null }}
      />,
    );

    expect(screen.getByRole("button", { name: "No current week yet" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "No settled week yet" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.queryByRole("link", { name: "No current week yet" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All weeks" })).toBeInTheDocument();
  });

  it("uses the gameweek and lifecycle in reachable segment labels", () => {
    render(
      <GameweekStrip
        slug="friends"
        gameweek={gameweek}
        adjacent={[]}
        gameweekAccess={{
          now: { id: "gw3", number: 3, label: "Gameweek 3", lifecycle: "CL3" },
          last: { id: "gw2", number: 2, label: "Gameweek 2", lifecycle: "CL5" },
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "GW3 · Live" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GW2 · Settled" })).toBeInTheDocument();
  });

  it("labels a void terminal week as Void, never Settled", () => {
    render(
      <GameweekStrip
        slug="friends"
        gameweek={gameweek}
        adjacent={[]}
        gameweekAccess={{
          now: { id: "gw3", number: 3, label: "Gameweek 3", lifecycle: "CL3" },
          last: { id: "gw2", number: 2, label: "Gameweek 2", lifecycle: "CL7" },
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "GW2 · Void" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "GW2 · Settled" })).not.toBeInTheDocument();
  });
});
