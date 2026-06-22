// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WinProbBar } from "./WinProbBar";

describe("WinProbBar", () => {
  it("rounds probabilities to whole percents and labels them in text + aria", () => {
    render(<WinProbBar probs={{ home: 0.521, draw: 0.27, away: 0.209 }} homeShort="GER" awayShort="FRA" />);

    // Not colour-only: the codes and percentages are present as text.
    expect(screen.getByText("GER")).toBeInTheDocument();
    expect(screen.getByText("FRA")).toBeInTheDocument();
    expect(screen.getByText("Draw")).toBeInTheDocument();
    expect(screen.getByText("52%")).toBeInTheDocument();
    expect(screen.getByText("27%")).toBeInTheDocument();
    expect(screen.getByText("21%")).toBeInTheDocument();

    // The bar exposes the same numbers to screen readers.
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Win probability — GER 52 percent, Draw 27 percent, FRA 21 percent",
    );
  });
});
