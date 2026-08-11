import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HomeTabs } from "../../components/HomeTabs";
import { useHomeTabsContext } from "../../components/HomeTabsContext";

afterEach(() => cleanup());

function Probe() {
  const { activeIndex, analyticsActivated } = useHomeTabsContext();
  return <span data-testid="probe">{`${activeIndex}:${analyticsActivated}`}</span>;
}

describe("HomeTabs analytics activation latch", () => {
  it("starts inactive, activates on the Analytics tab, and stays active after tabbing away", async () => {
    render(
      <HomeTabs
        leagues={<div>leagues</div>}
        matches={<div>matches</div>}
        analytics={<Probe />}
        analyticsVisible
      />,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("0:false");
    fireEvent.click(screen.getByRole("tab", { name: "Analytics" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("2:true"));
    fireEvent.click(screen.getByRole("tab", { name: "Leagues" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("0:true"));
  });
});
