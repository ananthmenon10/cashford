// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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

    const now = screen.getByRole("button", { name: "Now · No current week yet" });
    const last = screen.getByRole("button", { name: "Last · No settled week yet" });

    expect(within(now).getByText("Now", { exact: true })).toBeInTheDocument();
    expect(within(now).getByText("No current week yet", { exact: true })).toBeInTheDocument();
    expect(now).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(now).toHaveAttribute("disabled");
    expect(now).toHaveClass("text-cs2-ink-3");
    expect(now).not.toHaveClass("bg-cs2-green-soft", "text-cs2-green");
    expect(within(last).getByText("Last", { exact: true })).toBeInTheDocument();
    expect(within(last).getByText("No settled week yet", { exact: true })).toBeInTheDocument();
    expect(last).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(last).toHaveAttribute("disabled");
    expect(last).toHaveClass("text-cs2-ink-3");
    expect(last).not.toHaveClass("bg-cs2-green-soft", "text-cs2-green");
    expect(screen.queryByRole("link", { name: "Now · No current week yet" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
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

    const now = screen.getByRole("link", { name: "Now · GW3 · Live" });
    const last = screen.getByRole("link", { name: "Last · GW2 · Settled" });

    const nowPrimary = within(now).getByText("Now", { exact: true });
    const nowSupporting = within(now).getByText("GW3 · Live", { exact: true });
    const lastPrimary = within(last).getByText("Last", { exact: true });
    const lastSupporting = within(last).getByText("GW2 · Settled", { exact: true });

    expect(nowPrimary).toBeInTheDocument();
    expect(nowSupporting).toBeInTheDocument();
    expect(lastPrimary).toBeInTheDocument();
    expect(lastSupporting).toBeInTheDocument();
    expect(now).toHaveClass("min-w-0", "flex-1", "overflow-hidden");
    expect(nowPrimary).toHaveClass("truncate", "whitespace-nowrap");
    expect(nowSupporting).toHaveClass("truncate", "whitespace-nowrap");
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

    const last = screen.getByRole("link", { name: "Last · GW2 · Void" });

    expect(within(last).getByText("Last", { exact: true })).toBeInTheDocument();
    expect(within(last).getByText("GW2 · Void", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Last · GW2 · Settled" })).not.toBeInTheDocument();
  });
});
