// @vitest-environment jsdom

import { createElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TableStandard } from "../components/TableStandard";

describe("TableStandard", () => {
  it("keeps row paint and borders on rows, with insets only at the edges", () => {
    const { container } = render(
      createElement(TableStandard, {
        ariaLabel: "Test table",
        columns: [
          { key: "name", label: "Name", basis: 178, grow: 1 },
          { key: "points", label: "Pts", basis: 48, align: "center", numeric: true },
          { key: "net", label: "Net", basis: 64, align: "right", numeric: true },
        ],
        rows: [
          { key: "one", cells: ["One", 10, "+₹100"], tone: "viewer" },
          { key: "two", cells: ["Two", 8, "₹0"], tone: "live", liveLabel: "LIVE 64′" },
        ],
      }),
    );

    const rows = [...container.querySelectorAll<HTMLElement>('[role="row"]')];
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveClass("flex");
    expect(rows[1]).not.toHaveClass("grid");
    expect(rows[1]).toHaveClass("border-b");

    const viewerCells = [...rows[1].querySelectorAll<HTMLElement>('[role="cell"]')];
    expect(viewerCells[0]).toHaveAttribute("data-table-sticky", "true");
    expect(viewerCells[0]).toHaveClass("pl-[14px]");
    expect(viewerCells[0]).not.toHaveClass("pr-[14px]");
    expect(viewerCells[1]).not.toHaveClass("pl-[14px]");
    expect(viewerCells[1]).not.toHaveClass("pr-[14px]");
    expect(viewerCells[2]).toHaveClass("pr-[14px]");
    expect(viewerCells[0]).not.toHaveClass("border-b");
    expect(viewerCells[1]).not.toHaveClass("border-b");
    expect(viewerCells[0].style.backgroundColor).toBe("var(--color-cs2-paper)");
    expect(viewerCells[0].style.backgroundImage).toContain("var(--color-cs2-green-soft)");
    expect(viewerCells[1].style.backgroundImage).toBe("");

    const liveCells = [...rows[2].querySelectorAll<HTMLElement>('[role="cell"]')];
    expect(liveCells[0].style.backgroundColor).toBe("var(--color-cs2-canvas)");
    expect(liveCells[0].style.backgroundImage).toContain("var(--color-cs2-live-soft)");
    expect(liveCells[0].querySelector("[data-table-live-indicator]")).toHaveTextContent("LIVE 64′");
  });

  it("keeps the sticky header outside the horizontal body scrollport", () => {
    const { container } = render(
      createElement(TableStandard, {
        ariaLabel: "Test table",
        columns: [{ key: "name", label: "Name", basis: 178 }],
        rows: [{ key: "one", cells: ["One"] }],
      }),
    );

    const header = container.querySelector<HTMLElement>("[data-table-sticky-header]");
    const body = container.querySelector<HTMLElement>("[data-table-scroll]");
    expect(header).not.toBeNull();
    expect(body).not.toBeNull();
    expect(header).toHaveClass("sticky", "top-0");
    expect(header?.contains(body)).toBe(false);
    expect(header?.querySelector("[data-table-scroll]")).toBeNull();
  });
});
